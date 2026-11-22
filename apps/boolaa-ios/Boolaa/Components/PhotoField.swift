import PhotosUI
import SwiftUI

/// Photo picker with preview. Produces compressed JPEG data, or shows an existing remote image.
struct PhotoField: View {
    @Binding var jpeg: Data?
    var existingURL: String?
    var height: CGFloat = 200

    @State private var item: PhotosPickerItem?
    @State private var loading = false
    @State private var showPicker = false

    var body: some View {
        // The .photosPicker modifier avoids PhotosPicker's @Sendable label closure under Swift 6.
        Button { showPicker = true } label: { pickerLabel }
        .buttonStyle(.plain)
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
                    VStack(spacing: 6) {
                        Image(systemName: "photo.badge.plus").font(.system(size: 30))
                        Text("Choose a photo").font(.subheadline.weight(.semibold))
                    }
                    .foregroundStyle(Theme.brand)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Theme.field)
                }
                if loading { ProgressView().tint(.white) }
            }
            .frame(maxWidth: .infinity)
            .frame(height: height)
            .clipShape(RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous))
    }
}
