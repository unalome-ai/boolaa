import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Client-side image pipeline (docs/boolaa-spec.md, "Images"), shared with web (src/lib/image.ts) and Android.
/// Decodes the picked photo (JPEG, HEIC, PNG, WebP, ...), applies its EXIF orientation, downsizes it so the
/// long edge is at most 1600 px (avatars 512 px) and re-encodes it as JPEG 0.82. Only pixels are handed to
/// the encoder, so no metadata survives: no EXIF, GPS location, TIFF/maker notes, XMP or IPTC.
/// Byte limits mirror supabase/migrations/20261123100000_image_limits.sql.
enum ImageCompression {
    enum Failure: Error, Equatable { case tooLarge, unsupported }

    static let quality: CGFloat = 0.82
    /// Picked files above this are refused before decoding; a phone photo is well below it.
    static let maxInputBytes = 50 * 1024 * 1024

    static func maxSide(for bucket: BoolaaAPI.ImageBucket) -> Int { bucket == .avatars ? 512 : 1600 }
    static func maxBytes(for bucket: BoolaaAPI.ImageBucket) -> Int { (bucket == .avatars ? 2 : 5) * 1024 * 1024 }

    /// Size of an upright `width` x `height` image with its long edge capped at `maxSide` (never upscaled).
    static func targetSize(width: Int, height: Int, maxSide: Int) -> (width: Int, height: Int) {
        let scale = min(1, Double(maxSide) / Double(max(width, height)))
        return (max(1, Int((Double(width) * scale).rounded())), max(1, Int((Double(height) * scale).rounded())))
    }

    /// The JPEG to upload to `bucket`. Throws `Failure.unsupported` for undecodable data and `Failure.tooLarge`
    /// for oversized input or output.
    static func jpeg(from data: Data, for bucket: BoolaaAPI.ImageBucket) throws -> Data {
        let out = try jpeg(from: data, maxSide: maxSide(for: bucket))
        guard out.count <= maxBytes(for: bucket) else { throw Failure.tooLarge }
        return out
    }

    static func jpeg(from data: Data, maxSide: Int, quality: CGFloat = quality) throws -> Data {
        guard data.count <= maxInputBytes else { throw Failure.tooLarge }
        let options = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithData(data as CFData, options), CGImageSourceGetCount(source) > 0,
              let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let rawWidth = props[kCGImagePropertyPixelWidth] as? Int, let rawHeight = props[kCGImagePropertyPixelHeight] as? Int,
              rawWidth > 0, rawHeight > 0
        else { throw Failure.unsupported }

        // EXIF orientations 5...8 rotate by 90 degrees, so the upright image swaps width and height.
        let orientation = props[kCGImagePropertyOrientation] as? Int ?? 1
        let (uprightW, uprightH) = (5...8).contains(orientation) ? (rawHeight, rawWidth) : (rawWidth, rawHeight)
        let target = targetSize(width: uprightW, height: uprightH, maxSide: maxSide)

        // Decode straight at (about) the target size, upright. The thumbnail API never upscales.
        let thumbOptions = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: max(target.width, target.height),
        ] as CFDictionary
        guard let decoded = CGImageSourceCreateThumbnailAtIndex(source, 0, thumbOptions) else { throw Failure.unsupported }

        // Redraw at the exact target size on white (transparent areas would otherwise turn black in JPEG), sRGB.
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
              let context = CGContext(data: nil, width: target.width, height: target.height, bitsPerComponent: 8,
                                      bytesPerRow: 0, space: space, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
        else { throw Failure.unsupported }
        let rect = CGRect(x: 0, y: 0, width: target.width, height: target.height)
        context.setFillColor(CGColor(srgbRed: 1, green: 1, blue: 1, alpha: 1))
        context.fill(rect)
        context.interpolationQuality = .high
        context.draw(decoded, in: rect)
        guard let pixels = context.makeImage() else { throw Failure.unsupported }

        // Encode with no properties beyond the quality: nothing from the source's metadata is copied.
        let out = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil)
        else { throw Failure.unsupported }
        CGImageDestinationAddImage(destination, pixels, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw Failure.unsupported }
        return stripSegments(out as Data)
    }

    /// Drops the APP1...APP15 and COM header segments from a JPEG, keeping APP0 (JFIF) and the image data.
    /// ImageIO writes its own small Exif block (colour space, pixel size) and a Photoshop APP13 block even when
    /// given no metadata; nothing in them comes from the source photo, but the upload carries no metadata at all.
    static func stripSegments(_ jpeg: Data) -> Data {
        let b = [UInt8](jpeg)
        guard b.count > 4, b[0] == 0xFF, b[1] == 0xD8 else { return jpeg }
        var out: [UInt8] = [0xFF, 0xD8]
        out.reserveCapacity(b.count)
        var i = 2
        while i + 4 <= b.count, b[i] == 0xFF {
            let marker = b[i + 1]
            if marker == 0xDA { break } // start of scan: the rest is image data
            let end = i + 2 + (Int(b[i + 2]) << 8 | Int(b[i + 3]))
            guard end <= b.count else { return jpeg }
            if !((0xE1...0xEF).contains(marker) || marker == 0xFE) { out += b[i..<end] }
            i = end
        }
        out += b[i...]
        return Data(out)
    }
}
