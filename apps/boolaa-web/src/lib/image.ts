/**
 * Client-side image pipeline (docs/boolaa-spec.md, "Images"). Every photo is decoded, turned upright
 * (EXIF orientation), downsized and re-encoded as JPEG before upload. Re-encoding through a canvas
 * is what drops all metadata (EXIF, GPS location, XMP, ICC): the canvas only holds pixels.
 * The same numbers are used by iOS (ImageCompression.swift) and Android (ImageCompression.kt), and the
 * byte limits mirror storage.buckets in supabase/migrations/20261123100000_image_limits.sql.
 */

export type ImageBucket = "avatars" | "food.images" | "market.images";

const MB = 1024 * 1024;

/** Long-edge size in px and the bucket's upload limit in bytes. */
export const IMAGE_LIMITS: Record<ImageBucket, { maxSide: number; maxBytes: number }> = {
  avatars: { maxSide: 512, maxBytes: 2 * MB },
  "food.images": { maxSide: 1600, maxBytes: 5 * MB },
  "market.images": { maxSide: 1600, maxBytes: 5 * MB },
};

/** Picked files above this are refused before decoding (memory); a phone photo is well below it. */
export const MAX_INPUT_BYTES = 50 * MB;
export const JPEG_QUALITY = 0.82;

/** A picked file the pipeline refuses; mapped to `errors.imageTooLarge` / `errors.imageUnsupported`. */
export class ImageError extends Error {
  constructor(readonly code: "imageTooLarge" | "imageUnsupported") {
    super(code);
    this.name = "ImageError";
  }
}

/** Target size for an upright image of `width` x `height`: long edge at most `maxSide`, never upscaled. */
export function targetSize(width: number, height: number, maxSide: number) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Lists the metadata a JPEG carries (APP1 Exif / XMP, GPS IFD, Orientation tag, APP13 IPTC, COM) and its
 * frame size. Used by tests to prove uploads are clean; returns null for non-JPEG bytes.
 */
export function jpegInfo(bytes: Uint8Array) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const info = { width: 0, height: 0, exif: false, gps: false, orientation: false, xmp: false, iptc: false, comment: false };
  const ascii = (from: number, len: number) => String.fromCharCode(...bytes.subarray(from, from + len));
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return info;
    const marker = bytes[i + 1]!;
    if (marker === 0xd9 || marker === 0xda) break; // EOI / start of scan: no more headers
    const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    const body = i + 4;
    if (marker === 0xe1 && ascii(body, 6) === "Exif\0\0") {
      info.exif = true;
      const tags = exifTags(bytes.subarray(body + 6, i + 2 + len));
      info.gps = tags.has(0x8825);
      info.orientation = tags.has(0x0112);
    } else if (marker === 0xe1 && ascii(body, 28) === "http://ns.adobe.com/xap/1.0/") info.xmp = true;
    else if (marker === 0xed) info.iptc = true;
    else if (marker === 0xfe) info.comment = true;
    else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      info.height = (bytes[body + 1]! << 8) | bytes[body + 2]!;
      info.width = (bytes[body + 3]! << 8) | bytes[body + 4]!;
    }
    i += 2 + len;
  }
  return info;
}

/** Tag ids in IFD0 of a TIFF block (enough to spot Orientation 0x0112 and the GPS pointer 0x8825). */
function exifTags(tiff: Uint8Array) {
  const tags = new Set<number>();
  if (tiff.length < 8) return tags;
  const le = tiff[0] === 0x49;
  const u16 = (o: number) => (le ? tiff[o]! | (tiff[o + 1]! << 8) : (tiff[o]! << 8) | tiff[o + 1]!);
  const u32 = (o: number) => (le ? u16(o) + u16(o + 2) * 65536 : u16(o) * 65536 + u16(o + 2));
  const ifd = u32(4);
  if (ifd + 2 > tiff.length) return tags;
  const count = u16(ifd);
  for (let n = 0; n < count && ifd + 2 + n * 12 + 2 <= tiff.length; n++) tags.add(u16(ifd + 2 + n * 12));
  return tags;
}

/** Decodes with EXIF orientation applied (createImageBitmap, or an <img> where that option is missing). */
async function decodeUpright(file: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Older Safari: fall through to <img>, which also honours EXIF orientation.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return Object.assign(img, { width: img.naturalWidth, height: img.naturalHeight });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvas(width: number, height: number) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

/**
 * Turns a picked file into the JPEG to upload: upright, long edge <= the bucket's maxSide, no metadata.
 * Throws ImageError("imageUnsupported") when the browser can't decode it (e.g. HEIC outside Safari) and
 * ImageError("imageTooLarge") for absurdly large inputs or an output above the bucket limit.
 */
export async function prepareImage(file: Blob, bucket: ImageBucket): Promise<Blob> {
  const { maxSide, maxBytes } = IMAGE_LIMITS[bucket];
  if (file.size > MAX_INPUT_BYTES) throw new ImageError("imageTooLarge");
  if (file.type && !file.type.startsWith("image/")) throw new ImageError("imageUnsupported");

  let source: CanvasImageSource & { width: number; height: number };
  try {
    source = await decodeUpright(file);
  } catch {
    throw new ImageError("imageUnsupported");
  }
  if (!source.width || !source.height) throw new ImageError("imageUnsupported");
  const target = targetSize(source.width, source.height, maxSide);

  // Halve in steps before the final draw: one big downscale with drawImage aliases badly.
  let step: CanvasImageSource = source;
  let w = source.width;
  let h = source.height;
  while (w / 2 >= target.width * 1.5 && h / 2 >= target.height * 1.5) {
    w = Math.round(w / 2);
    h = Math.round(h / 2);
    const half = canvas(w, h);
    const ctx = half.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(step, 0, 0, w, h);
    step = half;
  }
  const out = canvas(target.width, target.height);
  const ctx = out.getContext("2d")!;
  ctx.fillStyle = "#ffffff"; // transparent PNG/WebP areas become white, not black
  ctx.fillRect(0, 0, target.width, target.height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(step, 0, 0, target.width, target.height);
  if ("close" in source && typeof source.close === "function") source.close();

  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  if (!blob || blob.type !== "image/jpeg") throw new ImageError("imageUnsupported");
  if (blob.size > maxBytes) throw new ImageError("imageTooLarge");
  return blob;
}
