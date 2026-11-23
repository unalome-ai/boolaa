import AVFoundation
import PhotosUI
import SwiftUI
import UIKit

/// Where a new photo comes from (docs/boolaa-spec.md, "Images" → "Camera").
enum PhotoSource: String, CaseIterable, Identifiable, Sendable {
    case camera, gallery
    var id: String { rawValue }

    /// What a photo slot offers: "Take photo" only on devices with a camera, then "Choose from gallery".
    static func options(cameraAvailable: Bool) -> [PhotoSource] { cameraAvailable ? [.camera, .gallery] : [.gallery] }

    /// With a single option the slot opens the gallery straight away instead of a one-button menu.
    static func needsMenu(cameraAvailable: Bool) -> Bool { options(cameraAvailable: cameraAvailable).count > 1 }
}

/// What tapping "Take photo" leads to, from the device's camera and its permission state.
enum CameraAccess: Equatable, Sendable {
    case ready, needsPrompt, denied, unavailable

    static func decide(available: Bool, status: AVAuthorizationStatus) -> CameraAccess {
        guard available else { return .unavailable }
        switch status {
        case .authorized: return .ready
        case .notDetermined: return .needsPrompt
        case .denied: return .denied
        // Restricted (Screen Time, MDM): the user can't change it in Settings, so the camera is simply unavailable.
        default: return .unavailable
        }
    }
}

/// A photo the user picked or took, before the shared pipeline (ImageCompression) turns it into the upload JPEG.
enum PickedPhoto {
    case gallery(PhotosPickerItem)
    case camera(UIImage)

    /// The photo's encoded bytes. A camera photo is encoded at high quality with its orientation tag, so
    /// ImageCompression makes it upright, downsizes it and strips the metadata exactly like a gallery photo.
    func data() async throws -> Data {
        switch self {
        case .gallery(let item):
            guard let data = try await item.loadTransferable(type: Data.self) else { throw ImageCompression.Failure.unsupported }
            return data
        case .camera(let image):
            let data = await Task.detached(priority: .userInitiated) { CameraCapture.encode(image) }.value
            guard let data else { throw ImageCompression.Failure.unsupported }
            return data
        }
    }
}

enum CameraCapture {
    /// Debug override (`-UITestCamera fixture|denied`): the simulator has no camera, so UI tests feed a
    /// fixture image through the camera path or exercise the "denied" message. Always nil in release builds.
    static var debugMode: String? {
        #if DEBUG
        DebugHooks.string("UITestCamera")
        #else
        nil
        #endif
    }

    @MainActor static var isAvailable: Bool {
        if debugMode != nil { return true }
        return UIImagePickerController.isSourceTypeAvailable(.camera)
    }

    @MainActor static func access() -> CameraAccess {
        switch debugMode {
        case "fixture": return .ready
        case "denied": return .denied
        default: return CameraAccess.decide(available: isAvailable, status: AVCaptureDevice.authorizationStatus(for: .video))
        }
    }

    /// Full-quality JPEG of a captured photo. `jpegData` writes the image's orientation as the EXIF tag
    /// (pixels stay as the sensor delivered them); ImageCompression applies it and drops all metadata.
    static func encode(_ image: UIImage) -> Data? { image.jpegData(compressionQuality: 0.95) }

    /// A stand-in camera photo: 2400 x 1600 sensor pixels (left half red, right half blue) shot in portrait,
    /// i.e. orientation `.right`, so it displays 1600 x 2400 with red on top, like Fixtures/exif-gps.jpg.
    static func fixtureImage() -> UIImage {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let raw = UIGraphicsImageRenderer(size: CGSize(width: 2400, height: 1600), format: format).image { ctx in
            UIColor.red.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: 1200, height: 1600))
            UIColor.blue.setFill(); ctx.fill(CGRect(x: 1200, y: 0, width: 1200, height: 1600))
        }
        return UIImage(cgImage: raw.cgImage!, scale: 1, orientation: .right)
    }
}

/// The photo slot's source menu. Setting `isPresented` opens "Take photo" / "Choose from gallery" (or the gallery
/// directly on devices without a camera); the chosen photo arrives in `onPicked`.
struct PhotoSourcePicker: ViewModifier {
    @Binding var isPresented: Bool
    var cameraDevice: UIImagePickerController.CameraDevice
    var onPicked: @MainActor (PickedPhoto) -> Void

    @State private var showMenu = false
    @State private var showGallery = false
    @State private var showCamera = false
    @State private var galleryItem: PhotosPickerItem?
    @State private var cameraProblem: CameraAccess?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.openURL) private var openURL

    func body(content: Content) -> some View {
        content
            .onChange(of: isPresented) { _, open in
                guard open else { return }
                isPresented = false
                if PhotoSource.needsMenu(cameraAvailable: CameraCapture.isAvailable) { showMenu = true } else { showGallery = true }
            }
            .confirmationDialog(Text("Add a photo"), isPresented: $showMenu, titleVisibility: .hidden) {
                ForEach(PhotoSource.options(cameraAvailable: CameraCapture.isAvailable)) { source in
                    switch source {
                    case .camera:
                        Button { Task { await takePhoto() } } label: {
                            Text("Take photo", comment: "Photo source menu: open the camera")
                        }
                        .accessibilityIdentifier("photo-source-camera")
                    case .gallery:
                        Button { showGallery = true } label: {
                            Text("Choose from gallery", comment: "Photo source menu: open the photo library")
                        }
                        .accessibilityIdentifier("photo-source-gallery")
                    }
                }
                Button("Cancel", role: .cancel) {}
            }
            .photosPicker(isPresented: $showGallery, selection: $galleryItem, matching: .images)
            .onChange(of: galleryItem) { _, item in
                guard let item else { return }
                galleryItem = nil
                onPicked(.gallery(item))
            }
            .fullScreenCover(isPresented: $showCamera) {
                CameraPicker(device: cameraDevice) { image in
                    present(false)
                    if let image { onPicked(.camera(image)) }
                }
                .ignoresSafeArea()
            }
            .alert(Text("Take photo", comment: "Photo source menu: open the camera"),
                   isPresented: Binding(get: { cameraProblem != nil }, set: { if !$0 { cameraProblem = nil } }),
                   presenting: cameraProblem) { problem in
                if problem == .denied {
                    Button("Open Settings") {
                        if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
                    }
                    .accessibilityIdentifier("camera-open-settings")
                    Button("Not now", role: .cancel) {}
                } else {
                    Button("OK", role: .cancel) {}
                }
            } message: { problem in
                if problem == .denied {
                    Text("Allow camera access in Settings to take photos.", comment: "Camera permission was denied")
                } else {
                    Text("Camera isn't available on this device.", comment: "The device has no usable camera")
                }
            }
    }

    private func takePhoto() async {
        #if DEBUG
        if CameraCapture.debugMode == "fixture" { onPicked(.camera(CameraCapture.fixtureImage())); return }
        #endif
        switch CameraCapture.access() {
        case .ready: present(true)
        case .needsPrompt:
            if await AVCaptureDevice.requestAccess(for: .video) { present(true) } else { cameraProblem = .denied }
        case .denied: cameraProblem = .denied
        case .unavailable: cameraProblem = .unavailable
        }
    }

    /// The camera slides up, or just appears with Reduce Motion on.
    private func present(_ show: Bool) {
        var transaction = Transaction()
        transaction.disablesAnimations = reduceMotion
        withTransaction(transaction) { showCamera = show }
    }
}

extension View {
    /// Photo source menu for a photo slot; `cameraDevice` is `.front` for selfies (avatars).
    func photoSourcePicker(isPresented: Binding<Bool>, cameraDevice: UIImagePickerController.CameraDevice = .rear,
                           onPicked: @escaping @MainActor (PickedPhoto) -> Void) -> some View {
        modifier(PhotoSourcePicker(isPresented: isPresented, cameraDevice: cameraDevice, onPicked: onPicked))
    }
}

/// The system camera (UIImagePickerController); SwiftUI has no camera picker. Returns the photo, or nil on cancel.
private struct CameraPicker: UIViewControllerRepresentable {
    var device: UIImagePickerController.CameraDevice
    var onFinish: @MainActor (UIImage?) -> Void

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.cameraCaptureMode = .photo
        if UIImagePickerController.isCameraDeviceAvailable(device) { picker.cameraDevice = device }
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onFinish: onFinish) }

    @MainActor final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onFinish: @MainActor (UIImage?) -> Void
        init(onFinish: @escaping @MainActor (UIImage?) -> Void) { self.onFinish = onFinish }

        func imagePickerController(_ picker: UIImagePickerController,
                                   didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            onFinish(info[.originalImage] as? UIImage)
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { onFinish(nil) }
    }
}
