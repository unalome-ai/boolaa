import { readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";
import ts from "typescript";
import { errorKey } from "../src/i18n/errors";
import { IMAGE_LIMITS, ImageError, jpegInfo, targetSize } from "../src/lib/image";
import { PASSWORD, SUPABASE_KEY, SUPABASE_URL } from "./helpers";

/**
 * Image pipeline (src/lib/image.ts, docs/boolaa-spec.md "Images") and the bucket limits
 * (supabase/migrations/20261123100000_image_limits.sql).
 * Fixture exif-gps.jpg: stored 2400x1600 (left half red, right half blue) with EXIF Orientation 6
 * (displayed 1600x2400, red on top), GPS coordinates and camera make/model. Shared with iOS and Android.
 */
const FIXTURE = readFileSync(path.join(__dirname, "fixtures", "exif-gps.jpg"));

test.describe("unit", () => {
  test("target size keeps the aspect ratio, caps the long edge and never upscales", () => {
    expect(targetSize(4032, 3024, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(targetSize(1600, 2400, 1600)).toEqual({ width: 1067, height: 1600 });
    expect(targetSize(3000, 3000, 512)).toEqual({ width: 512, height: 512 });
    expect(targetSize(800, 600, 1600)).toEqual({ width: 800, height: 600 });
    expect(targetSize(10000, 10, 1600)).toEqual({ width: 1600, height: 2 });
    expect(IMAGE_LIMITS.avatars).toEqual({ maxSide: 512, maxBytes: 2 * 1024 * 1024 });
    expect(IMAGE_LIMITS["food.images"]).toEqual({ maxSide: 1600, maxBytes: 5 * 1024 * 1024 });
    expect(IMAGE_LIMITS["market.images"]).toEqual({ maxSide: 1600, maxBytes: 5 * 1024 * 1024 });
  });

  test("jpegInfo sees the fixture's EXIF, GPS and orientation", () => {
    expect(jpegInfo(FIXTURE)).toMatchObject({ width: 2400, height: 1600, exif: true, gps: true, orientation: true });
    expect(jpegInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });

  test("image and storage limit errors map to translated keys", () => {
    expect(errorKey(new ImageError("imageTooLarge"))).toBe("imageTooLarge");
    expect(errorKey(new ImageError("imageUnsupported"))).toBe("imageUnsupported");
    // storage-js StorageApiError shapes (local: HTTP 400 with the code in statusCode; hosted: HTTP 413/415).
    const storageError = (message: string, status: number, statusCode: string) =>
      Object.assign(new Error(message), { name: "StorageApiError", status, statusCode });
    expect(errorKey(storageError("The object exceeded the maximum allowed size", 400, "413"))).toBe("imageTooLarge");
    expect(errorKey(storageError("Payload too large", 413, "413"))).toBe("imageTooLarge");
    expect(errorKey(storageError("mime type image/png is not supported", 400, "415"))).toBe("imageUnsupported");
    expect(errorKey(storageError("invalid_mime_type", 415, "415"))).toBe("imageUnsupported");
    expect(errorKey(storageError("Internal error", 500, "500"))).toBe("uploadFailed");
  });
});

test.describe("browser pipeline", () => {
  /** Loads src/lib/image.ts (transpiled) into a blank page as window.__image. */
  async function loadPipeline(page: import("@playwright/test").Page) {
    const source = readFileSync(path.join(__dirname, "..", "src", "lib", "image.ts"), "utf8");
    const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
    await page.setContent("<!doctype html><title>image pipeline</title>");
    await page.addScriptTag({ type: "module", content: `${js.outputText}\nwindow.__image = { prepareImage, jpegInfo };` });
    await page.waitForFunction(() => "__image" in window);
  }

  /** Runs prepareImage on bytes in the page; returns the output bytes, type and top/bottom pixel colours. */
  async function run(page: import("@playwright/test").Page, bytes: Buffer, type: string, bucket: string) {
    return page.evaluate(
      async ({ data, type, bucket }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const lib = (window as any).__image;
        try {
          const out: Blob = await lib.prepareImage(new Blob([new Uint8Array(data)], { type }), bucket);
          const bmp = await createImageBitmap(out);
          const c = new OffscreenCanvas(bmp.width, bmp.height);
          const ctx = c.getContext("2d")!;
          ctx.drawImage(bmp, 0, 0);
          const px = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
          const mid = Math.floor(bmp.width / 2);
          return {
            type: out.type,
            size: out.size,
            bytes: Array.from(new Uint8Array(await out.arrayBuffer())),
            top: px(mid, 5),
            bottom: px(mid, bmp.height - 5),
          };
        } catch (e) {
          return { error: (e as Error).name, code: (e as { code?: string }).code };
        }
      },
      { data: Array.from(bytes), type, bucket },
    );
  }

  test("photos are made upright, downsized and stripped of EXIF/GPS", async ({ page }) => {
    await loadPipeline(page);
    for (const [bucket, w, h] of [
      ["food.images", 1067, 1600],
      ["market.images", 1067, 1600],
      ["avatars", 341, 512],
    ] as const) {
      const out = await run(page, FIXTURE, "image/jpeg", bucket);
      expect(out.type, bucket).toBe("image/jpeg");
      const info = jpegInfo(new Uint8Array(out.bytes!));
      expect(info, bucket).toMatchObject({ width: w, height: h, exif: false, gps: false, orientation: false, xmp: false, iptc: false });
      expect(Buffer.from(out.bytes!).includes("BoolaaTestCam"), bucket).toBe(false);
      // Orientation 6 applied: red (stored left half) is now on top, blue at the bottom.
      expect(out.top![0]).toBeGreaterThan(200);
      expect(out.top![2]).toBeLessThan(60);
      expect(out.bottom![2]).toBeGreaterThan(200);
      expect(out.bottom![0]).toBeLessThan(60);
    }
  });

  test("small images are not upscaled; PNG becomes JPEG", async ({ page }) => {
    await loadPipeline(page);
    const png = await page.evaluate(async () => {
      const c = new OffscreenCanvas(300, 200);
      c.getContext("2d")!.fillRect(0, 0, 300, 200);
      return Array.from(new Uint8Array(await (await c.convertToBlob({ type: "image/png" })).arrayBuffer()));
    });
    const out = await run(page, Buffer.from(png), "image/png", "food.images");
    expect(out.type).toBe("image/jpeg");
    expect(jpegInfo(new Uint8Array(out.bytes!))).toMatchObject({ width: 300, height: 200, exif: false });
  });

  test("undecodable and non-image files are refused as unsupported", async ({ page }) => {
    await loadPipeline(page);
    expect(await run(page, Buffer.from("not an image at all"), "image/jpeg", "food.images")).toEqual({
      error: "ImageError",
      code: "imageUnsupported",
    });
    expect(await run(page, Buffer.from("%PDF-1.4"), "application/pdf", "food.images")).toEqual({
      error: "ImageError",
      code: "imageUnsupported",
    });
  });
});

test.describe("bucket limits (local Supabase)", () => {
  test("storage refuses oversized and non-JPEG/WebP uploads; errors map to the image keys", async () => {
    const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
    const { data, error } = await sb.auth.signInWithPassword({ email: "alice@boolaa.test", password: PASSWORD });
    expect(error).toBeNull();
    const uid = data.user!.id;
    const tooBig = new Uint8Array(2 * 1024 * 1024 + 1024);
    const big = await sb.storage.from("avatars").upload(`${uid}/limit-${Date.now()}.jpg`, tooBig, { contentType: "image/jpeg" });
    expect(big.error).not.toBeNull();
    expect(errorKey(big.error)).toBe("imageTooLarge");
    const tooBigFood = new Uint8Array(5 * 1024 * 1024 + 1024);
    const bigFood = await sb.storage.from("food.images").upload(`${uid}/limit-${Date.now()}.jpg`, tooBigFood, { contentType: "image/jpeg" });
    expect(errorKey(bigFood.error)).toBe("imageTooLarge");
    for (const contentType of ["image/png", "image/gif", "image/heic", "image/svg+xml", "text/plain"]) {
      const res = await sb.storage.from("market.images").upload(`${uid}/limit-${Date.now()}.bin`, new Uint8Array(16), { contentType });
      expect(res.error, contentType).not.toBeNull();
      expect(errorKey(res.error), contentType).toBe("imageUnsupported");
    }
    await sb.auth.signOut({ scope: "local" });
  });
});
