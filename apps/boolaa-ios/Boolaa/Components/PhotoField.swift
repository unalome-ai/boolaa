import PhotosUI
import SwiftUI

/// Photo picker with preview. Produces compressed JPEG data, or shows an existing remote image.
struct PhotoField: View {
    @Binding var jpeg: Data?
    var existingURL: String?
    var height: CGFloat = 200
    var hue: Hue = .grape

    @State private var item: PhotosPickerItem?
    @State private var loading = false
    @State private var showPicker = false

    var body: some View {
        // The .photosPicker modifier avoids PhotosPicker's @Sendable label closure under Swift 6.
        Button { showPicker = true } label: { pickerLabel }
        .buttonStyle(.squish)
        .photosPicker(isPresented: $showPicker, selection: $item, matching: .images)
        .accessibilityIdentifier("photo-picker")
        .onChange(of: item) { _, newItem in
            guard let newItem else { return }
            loading = true
            Task {
                defer { loading = false }
                if let data = try? await newItem.loadTransferable(type: Data.self) {
                    jpeg = ImageCompression.jpeg(from: data)
                }
            }
        }
    }

    private var pickerLabel: some View {
            ZStack {
                if let jpeg, let image = UIImage(data: jpeg) {
                    Image(uiImage: image).resizable().scaledToFill()
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
    }
}
