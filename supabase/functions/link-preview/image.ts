// Preview images: the og:image is downloaded through the same SSRF guard, checked (magic bytes,
// pixel dimensions read from the header before decoding, so a small file can't expand into a
// huge bitmap) and re-encoded as a metadata-free JPEG (long edge at most 1200 px, quality 82,
// on white), like the app's own image pipeline. Clients then load our copy from Storage and
// never contact the third-party image host.
import { decode, Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";

export const IMAGE_MAX_BYTES = 3 * 1024 * 1024; // download cap
export const IMAGE_MAX_PIXELS = 16_000_000;
export const IMAGE_MAX_SIDE = 8192;
export const IMAGE_MIN_SIDE = 48; // smaller is an icon or a tracking pixel
export const IMAGE_LONG_EDGE = 1200;
export const IMAGE_OUT_MAX_BYTES = 1024 * 1024; // bucket limit

export type ImageKind = "jpeg" | "png" | "gif" | "webp";

export function sniff(b: Uint8Array): ImageKind | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "gif";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
  return null; // SVG, HTML, anything else: refused
}

/** Width and height from the file header, without decoding. */
export function dimensions(b: Uint8Array, kind: ImageKind): { w: number; h: number } | null {
  const be16 = (o: number) => (b[o] << 8) | b[o + 1];
  const le16 = (o: number) => b[o] | (b[o + 1] << 8);
  const be32 = (o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  if (kind === "png") return b.length >= 24 ? { w: be32(16), h: be32(20) } : null;
  if (kind === "gif") return b.length >= 10 ? { w: le16(6), h: le16(8) } : null;
  if (kind === "webp") {
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (chunk === "VP8X" && b.length >= 30) return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
    if (chunk === "VP8L" && b.length >= 25) {
      const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8 " && b.length >= 30) return { w: le16(26) & 0x3fff, h: le16(28) & 0x3fff };
    return null;
  }
  // JPEG: walk the markers to the first SOFn.
  let o = 2;
  while (o + 9 < b.length) {
    if (b[o] !== 0xff) return null;
    const marker = b[o + 1];
    if (marker === 0xff) {
      o++;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      o += 2;
      continue;
    }
    const len = be16(o + 2);
    if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { w: be16(o + 7), h: be16(o + 5) };
    }
    o += 2 + len;
  }
  return null;
}

export class ImageRejected extends Error {}

/** Checks and re-encodes a downloaded image. Throws ImageRejected when it isn't usable. */
export async function toPreviewJpeg(bytes: Uint8Array): Promise<Uint8Array> {
  const kind = sniff(bytes);
  if (!kind) throw new ImageRejected("not a raster image");
  const dim = dimensions(bytes, kind);
  if (!dim || dim.w <= 0 || dim.h <= 0) throw new ImageRejected("no dimensions");
  if (dim.w > IMAGE_MAX_SIDE || dim.h > IMAGE_MAX_SIDE || dim.w * dim.h > IMAGE_MAX_PIXELS) throw new ImageRejected("too many pixels");
  if (dim.w < IMAGE_MIN_SIDE || dim.h < IMAGE_MIN_SIDE) throw new ImageRejected("too small");

  let img: Image;
  try {
    const d = await decode(bytes, true); // first frame of a GIF
    // deno-lint-ignore no-explicit-any
    img = d instanceof Image ? d : (d as any)[0];
    if (!(img instanceof Image)) throw new Error("no frame");
  } catch {
    throw new ImageRejected("undecodable");
  }
  if (img.width * img.height > IMAGE_MAX_PIXELS) throw new ImageRejected("too many pixels");

  const long = Math.max(img.width, img.height);
  if (long > IMAGE_LONG_EDGE) {
    const w = Math.max(1, Math.round((img.width * IMAGE_LONG_EDGE) / long));
    const h = Math.max(1, Math.round((img.height * IMAGE_LONG_EDGE) / long));
    img = img.resize(w, h);
  }
  // Transparent areas become white, not black.
  const out = new Image(img.width, img.height).fill(0xffffffff).composite(img, 0, 0);
  const jpeg = await out.encodeJPEG(82);
  if (jpeg.length > IMAGE_OUT_MAX_BYTES) throw new ImageRejected("too large after encoding");
  return jpeg;
}
