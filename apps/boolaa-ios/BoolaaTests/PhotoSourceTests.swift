import AVFoundation
import Foundation
import Testing
import UIKit
@testable import Boolaa

@Suite("Photo source (camera + gallery)")
struct PhotoSourceTests {
    @Test func menuOffersCameraOnlyWhenTheDeviceHasOne() {
        #expect(PhotoSource.options(cameraAvailable: true) == [.camera, .gallery])
        #expect(PhotoSource.options(cameraAvailable: false) == [.gallery])
        // No camera (the simulator, some iPads without one): the slot opens the gallery directly.
        #expect(PhotoSource.needsMenu(cameraAvailable: true))
        #expect(!PhotoSource.needsMenu(cameraAvailable: false))
    }

    @Test func cameraAccessDecision() {
        #expect(CameraAccess.decide(available: true, status: .authorized) == .ready)
        #expect(CameraAccess.decide(available: true, status: .notDetermined) == .needsPrompt)
        #expect(CameraAccess.decide(available: true, status: .denied) == .denied)
        #expect(CameraAccess.decide(available: true, status: .restricted) == .unavailable)
        for status in [AVAuthorizationStatus.authorized, .notDetermined, .denied, .restricted] {
            #expect(CameraAccess.decide(available: false, status: status) == .unavailable)
        }
    }

    @MainActor @Test func simulatorHasNoCamera() {
        // Without -UITestCamera the real check applies; the simulator never has a camera.
        #expect(CameraCapture.debugMode == nil)
        #expect(!CameraCapture.isAvailable)
        #expect(CameraCapture.access() == .unavailable)
    }

    /// A portrait camera photo (sensor pixels landscape, orientation `.right`) goes through the same pipeline as a
    /// gallery photo: upright, long edge capped (1600 px, avatars 512 px), JPEG without any metadata.
    @Test(arguments: [(BoolaaAPI.ImageBucket.food, 1067, 1600), (.chat, 1067, 1600), (.avatars, 341, 512)])
    func cameraPhotoUsesTheSharedPipeline(bucket: BoolaaAPI.ImageBucket, width: Int, height: Int) async throws {
        let raw = try await PickedPhoto.camera(CameraCapture.fixtureImage()).data()
        let jpeg = try ImageCompression.jpeg(from: raw, for: bucket)
        let image = try #require(UIImage(data: jpeg))
        #expect(image.imageOrientation == .up)
        #expect(Int(image.size.width) == width && Int(image.size.height) == height)
        // Upright means red (the sensor's left half) is now on top.
        let cg = try #require(image.cgImage)
        #expect(try topIsRed(cg))
        #expect(jpeg.count <= ImageCompression.maxBytes(for: bucket))
        #expect(ImageCompression.stripSegments(jpeg) == jpeg, "metadata segments left in the upload")
    }

    private func topIsRed(_ image: CGImage) throws -> Bool {
        var rgba = [UInt8](repeating: 0, count: 4)
        let ctx = try #require(CGContext(data: &rgba, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
                                         space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                         bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        // Sample (width/2, 10) in top-left coordinates.
        ctx.draw(image, in: CGRect(x: -image.width / 2, y: 10 - image.height + 1, width: image.width, height: image.height))
        return rgba[0] > 200 && rgba[2] < 60
    }
}
