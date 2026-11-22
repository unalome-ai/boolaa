import CoreGraphics
import Foundation
import ImageIO
import Supabase
import Testing
import UniformTypeIdentifiers
@testable import Boolaa

private final class BundleToken {}

/// Fixtures/exif-gps.jpg (shared with web and Android): stored 2400x1600, left half red and right half blue,
/// EXIF Orientation 6 (displayed 1600x2400, red on top), GPS coordinates and camera make "BoolaaTestCam".
private func exifFixture() throws -> Data {
    let url = try #require(Bundle(for: BundleToken.self).url(forResource: "exif-gps", withExtension: "jpg"))
    return try Data(contentsOf: url)
}

/// What a JPEG's header segments carry: APP1 Exif / XMP, APP13 IPTC, comments, plus its frame size.
private struct JPEGSegments {
    var width = 0, height = 0
    var exif = false, xmp = false, iptc = false, comment = false

    init(_ data: Data) throws {
        let b = [UInt8](data)
        try #require(b.count > 4 && b[0] == 0xFF && b[1] == 0xD8, "not a JPEG")
        var i = 2
        while i + 4 <= b.count, b[i] == 0xFF {
            let marker = b[i + 1]
            if marker == 0xD9 || marker == 0xDA { break }
            let len = Int(b[i + 2]) << 8 | Int(b[i + 3])
            let body = Array(b[(i + 4)..<min(b.count, i + 2 + len)])
            if marker == 0xE1, body.starts(with: Array("Exif\0\0".utf8)) { exif = true }
            if marker == 0xE1, body.starts(with: Array("http://ns.adobe.com/xap/1.0/".utf8)) { xmp = true }
            if marker == 0xED { iptc = true }
            if marker == 0xFE { comment = true }
            if (0xC0...0xCF).contains(marker), ![0xC4, 0xC8, 0xCC].contains(marker) {
                height = Int(body[1]) << 8 | Int(body[2])
                width = Int(body[3]) << 8 | Int(body[4])
            }
            i += 2 + len
        }
    }
}

private func properties(_ data: Data) throws -> [CFString: Any] {
    let source = try #require(CGImageSourceCreateWithData(data as CFData, nil))
    return try #require(CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any])
}

/// RGB of the pixel at (x, y), top-left origin, as decoded without applying any orientation.
private func pixel(_ data: Data, x: Int, y: Int) throws -> (r: Int, g: Int, b: Int) {
    let source = try #require(CGImageSourceCreateWithData(data as CFData, nil))
    let image = try #require(CGImageSourceCreateImageAtIndex(source, 0, nil))
    var rgba = [UInt8](repeating: 0, count: 4)
    let ctx = try #require(CGContext(data: &rgba, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                                     space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                     bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
    ctx.draw(image, in: CGRect(x: -x, y: y - image.height + 1, width: image.width, height: image.height))
    return (Int(rgba[0]), Int(rgba[1]), Int(rgba[2]))
}

/// Asserts the output is clean: JPEG, expected size, no EXIF / GPS / TIFF / XMP / IPTC, upright (red top, blue bottom).
private func expectClean(_ out: Data, width: Int, height: Int, upright: Bool = true) throws {
    let segments = try JPEGSegments(out)
    #expect(segments.width == width && segments.height == height, "size \(segments.width)x\(segments.height)")
    #expect(!segments.exif && !segments.xmp && !segments.iptc && !segments.comment, "metadata segment left: \(segments)")
    #expect(out.range(of: Data("BoolaaTestCam".utf8)) == nil)
    let props = try properties(out)
    #expect(props[kCGImagePropertyGPSDictionary] == nil)
    #expect(props[kCGImagePropertyTIFFDictionary] == nil)
    #expect((props[kCGImagePropertyOrientation] as? Int ?? 1) == 1)
    let exif = props[kCGImagePropertyExifDictionary] as? [CFString: Any] ?? [:]
    #expect(exif[kCGImagePropertyExifDateTimeOriginal] == nil)
    if upright {
        let top = try pixel(out, x: width / 2, y: 4), bottom = try pixel(out, x: width / 2, y: height - 5)
        #expect(top.r > 200 && top.b < 60, "top should be red: \(top)")
        #expect(bottom.b > 200 && bottom.r < 60, "bottom should be blue: \(bottom)")
    }
}

@Suite("Image pipeline")
struct ImageProcessingTests {
    @Test func targetSizeMatchesWebAndAndroid() {
        #expect(ImageCompression.targetSize(width: 4032, height: 3024, maxSide: 1600) == (1600, 1200))
        #expect(ImageCompression.targetSize(width: 1600, height: 2400, maxSide: 1600) == (1067, 1600))
        #expect(ImageCompression.targetSize(width: 3000, height: 3000, maxSide: 512) == (512, 512))
        #expect(ImageCompression.targetSize(width: 800, height: 600, maxSide: 1600) == (800, 600))
        #expect(ImageCompression.targetSize(width: 10000, height: 10, maxSide: 1600) == (1600, 2))
        #expect(ImageCompression.maxSide(for: .avatars) == 512 && ImageCompression.maxSide(for: .food) == 1600)
        #expect(ImageCompression.maxBytes(for: .avatars) == 2 * 1024 * 1024)
        #expect(ImageCompression.maxBytes(for: .market) == 5 * 1024 * 1024)
    }

    @Test func fixtureReallyCarriesGPSAndOrientation() throws {
        let props = try properties(try exifFixture())
        #expect(props[kCGImagePropertyGPSDictionary] != nil)
        #expect(props[kCGImagePropertyOrientation] as? Int == 6)
        #expect(try JPEGSegments(try exifFixture()).exif)
    }

    @Test(arguments: [(BoolaaAPI.ImageBucket.food, 1067, 1600), (.market, 1067, 1600), (.avatars, 341, 512), (.bubbles, 341, 512)])
    func photosAreUprightDownsizedAndStripped(bucket: BoolaaAPI.ImageBucket, width: Int, height: Int) throws {
        try expectClean(try ImageCompression.jpeg(from: try exifFixture(), for: bucket), width: width, height: height)
    }

    @Test func heicWithGPSIsReencodedAsCleanJPEG() throws {
        // Photos hands over HEIC originals; build one with GPS + orientation from the fixture's pixels.
        let source = try #require(CGImageSourceCreateWithData(try exifFixture() as CFData, nil))
        let image = try #require(CGImageSourceCreateImageAtIndex(source, 0, nil))
        let heic = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(heic, UTType.heic.identifier as CFString, 1, nil) else {
            return // no HEIC encoder on this simulator runtime; JPEG path above covers the pipeline
        }
        let meta: [CFString: Any] = [
            kCGImagePropertyOrientation: 6,
            kCGImagePropertyGPSDictionary: [kCGImagePropertyGPSLatitude: 44.43, kCGImagePropertyGPSLatitudeRef: "N",
                                            kCGImagePropertyGPSLongitude: 26.1, kCGImagePropertyGPSLongitudeRef: "E"],
        ]
        CGImageDestinationAddImage(dest, image, meta as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { return }
        #expect(try properties(heic as Data)[kCGImagePropertyGPSDictionary] != nil)
        try expectClean(try ImageCompression.jpeg(from: heic as Data, for: .food), width: 1067, height: 1600)
    }

    @Test func smallPNGIsNotUpscaledAndBecomesJPEG() throws {
        let ctx = try #require(CGContext(data: nil, width: 300, height: 200, bitsPerComponent: 8, bytesPerRow: 0,
                                         space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                         bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        let png = NSMutableData()
        let dest = try #require(CGImageDestinationCreateWithData(png, UTType.png.identifier as CFString, 1, nil))
        CGImageDestinationAddImage(dest, try #require(ctx.makeImage()), nil)
        #expect(CGImageDestinationFinalize(dest))
        let out = try ImageCompression.jpeg(from: png as Data, for: .market)
        try expectClean(out, width: 300, height: 200, upright: false)
        // Fully transparent PNG is flattened onto white, not black.
        let p = try pixel(out, x: 150, y: 100)
        #expect(p.r > 240 && p.g > 240 && p.b > 240)
    }

    @Test func undecodableAndHugeInputsAreRefused() {
        #expect(throws: ImageCompression.Failure.unsupported) { try ImageCompression.jpeg(from: Data("not an image".utf8), for: .food) }
        #expect(throws: ImageCompression.Failure.unsupported) { try ImageCompression.jpeg(from: Data(), for: .avatars) }
        let huge = Data(count: ImageCompression.maxInputBytes + 1)
        #expect(throws: ImageCompression.Failure.tooLarge) { try ImageCompression.jpeg(from: huge, for: .food) }
    }

    @Test func imageAndStorageErrorsMapToTranslatedMessages() {
        #expect(UserFacingError.classify(ImageCompression.Failure.tooLarge) == .imageTooLarge)
        #expect(UserFacingError.classify(ImageCompression.Failure.unsupported) == .imageUnsupported)
        let tooLarge = StorageError(statusCode: "413", message: "The object exceeded the maximum allowed size", error: "Payload too large")
        let badType = StorageError(statusCode: "415", message: "mime type image/png is not supported", error: "invalid_mime_type")
        #expect(UserFacingError.classify(tooLarge) == .imageTooLarge)
        #expect(UserFacingError.classify(badType) == .imageUnsupported)
        #expect(UserFacingError.classify(StorageError(statusCode: "500", message: "internal")) == .generic)
        #expect(UserFacingError.imageTooLarge.message.key == "That photo is too large. Pick a smaller one.")
    }
}

/// The pipeline's output against the local Supabase (bucket limits from 20261123100000_image_limits.sql).
@Suite("Image uploads (local backend)", .serialized)
struct ImageUploadIntegrationTests {
    private func alice() async throws -> BoolaaAPI {
        let client = Backend.makeClient(config: try AppConfig.load(), authStorage: InMemoryAuthStorage())
        try await client.auth.signIn(email: "alice@boolaa.test", password: "password123")
        return BoolaaAPI(client: client)
    }

    @Test func uploadedPhotoIsCleanAndLimitsAreMapped() async throws {
        let api = try await alice()
        let jpeg = try ImageCompression.jpeg(from: try exifFixture(), for: .food)
        let url = try await api.uploadImage(jpeg, bucket: .food, userID: Seed.alice)
        var request = URLRequest(url: try #require(URL(string: url)), cachePolicy: .reloadIgnoringLocalAndRemoteCacheData)
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        let (stored, response) = try await URLSession(configuration: .ephemeral).data(for: request)
        #expect((response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Type") == "image/jpeg")
        try expectClean(stored, width: 1067, height: 1600)
        await api.removeImage(publicURL: url, bucket: .food, userID: Seed.alice)

        // Server-side limits: avatars take at most 2 MB, and only JPEG / WebP.
        let storage = api.client.storage
        do {
            try await storage.from("avatars").upload("\(Seed.alice.uuidString.lowercased())/zz-limit.jpg",
                                                     data: Data(count: 2 * 1024 * 1024 + 1024),
                                                     options: FileOptions(contentType: "image/jpeg"))
            Issue.record("oversized avatar was accepted")
        } catch { #expect(UserFacingError.classify(error) == .imageTooLarge, "\(error)") }
        do {
            try await storage.from("market.images").upload("\(Seed.alice.uuidString.lowercased())/zz-limit.png",
                                                           data: Data(count: 16), options: FileOptions(contentType: "image/png"))
            Issue.record("PNG was accepted")
        } catch { #expect(UserFacingError.classify(error) == .imageUnsupported, "\(error)") }
    }
}
