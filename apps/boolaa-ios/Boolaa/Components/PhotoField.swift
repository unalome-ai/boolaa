import SwiftUI

/// Photo slot with preview: "Take photo" or "Choose from gallery" (PhotoSourcePicker). Produces the upload-ready JPEG for `bucket` (ImageCompression: upright, downsized,
/// no EXIF/GPS), or shows an existing remote image. A photo that can't be used sets `error`.
struct PhotoField: View {
    @Binding var jpeg: Data?
    var bucket: BoolaaAPI.ImageBucket
    @Binding var error: String?
    var existingURL: String?
    var height: CGFloat = 200
    var hue: Hue = .grape

    @State private var loading = false
    @State private var showPicker = false

    var body: some View {
        Button { showPicker = true } label: { pickerLabel }
        .buttonStyle(.squish)
        .photoSourcePicker(isPresented: $showPicker) { picked in
            loading = true
            Task {
                defer { loading = false }
                do {
                    let data = try await picked.data()
                    let bucket = bucket
                    jpeg = try await Task.detached(priority: .userInitiated) {
                        try ImageCompression.jpeg(from: data, for: bucket)
                    }.value
                } catch {
                    self.error = error.userMessage
                }
            }
        }
        .accessibilityIdentifier("photo-picker")
    }

    private var pickerLabel: some View {
            ZStack {
                if let jpeg, let image = UIImage(data: jpeg) {
                    // The photo never takes taps: its scaledToFill overflow would cover the fields below.
                    Image(uiImage: image).resizable().scaledToFill().allowsHitTesting(false)
                } else if let existingURL {
                    RemoteImage(url: existingURL)
                } else {
                    VStack(spacing: 10) {
                        BubbleCluster(icon: "camera.fill", hue: hue, size: 72)
                        Text("Choose a photo").font(.rounded(.subheadline)).foregroundStyle(hue.text)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(hue.wash)
                    .overlay(RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous)
                        .strokeBorder(hue.text.opacity(0.3), style: StrokeStyle(lineWidth: 1.5, dash: [6, 6])))
                }
                if loading { ProgressView().tint(.white) }
            }
            .frame(maxWidth: .infinity)
            .frame(height: height)
            .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous))
    }
}
