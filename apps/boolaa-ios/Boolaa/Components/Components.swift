import SwiftUI

/// Circular avatar with a 2pt purple border; initials when there is no photo.
struct AvatarView: View {
    var url: URL?
    var name: String
    var size: CGFloat = 40

    var body: some View {
        ZStack {
            Circle().fill(Theme.brand.opacity(0.18))
            if let url {
                AsyncImage(url: url) { phase in
                    if let image = phase.image {
                        image.resizable().scaledToFill()
                    } else {
                        initials
                    }
                }
            } else {
                initials
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().stroke(Theme.brand, lineWidth: 2))
        .accessibilityLabel(Text("Avatar of \(name)", comment: "Accessibility label; the argument is a person's name"))
    }

    private var initials: some View {
        Text(Self.initials(for: name))
            .font(.system(size: size * 0.38, weight: .semibold, design: .rounded))
            .foregroundStyle(Theme.brand)
    }

    nonisolated static func initials(for name: String) -> String {
        let parts = name.split(whereSeparator: { $0.isWhitespace }).prefix(2)
        let letters = parts.compactMap(\.first).map { String($0).uppercased() }.joined()
        return letters.isEmpty ? "?" : letters
    }
}

extension AvatarView {
    init(user: UserProfile?, size: CGFloat = 40) {
        self.init(url: user?.avatarURL, name: user?.displayName ?? "?", size: size)
    }
}

/// Capsule chip used for the bubble switcher and filters.
/// `title` is shown verbatim: pass `String(localized:)` for UI text, raw names for user content.
struct ChipView: View {
    var title: String
    var isActive: Bool
    var systemImage: String? = nil
    var outlined = false

    var body: some View {
        HStack(spacing: 4) {
            if let systemImage { Image(systemName: systemImage).font(.system(size: 13, weight: .bold)) }
            Text(verbatim: title).font(.subheadline.weight(.semibold)).lineLimit(1)
        }
        .foregroundStyle(isActive ? Color.white : Theme.brand)
        .padding(.horizontal, 14)
        .frame(height: 34)
        .background(
            Capsule().fill(isActive ? Theme.brand : (outlined ? Color.clear : Theme.chipInactive))
        )
        .overlay(
            Capsule().stroke(isActive ? Theme.accent : (outlined ? Theme.brand : .clear), lineWidth: 2)
        )
    }
}

/// Remote image that fills its frame.
struct RemoteImage: View {
    var url: String?
    var body: some View {
        AsyncImage(url: url.flatMap(URL.init(string:))) { phase in
            switch phase {
            case .success(let image): image.resizable().scaledToFill()
            case .failure: placeholder(icon: "photo")
            default: placeholder(icon: nil)
            }
        }
        .clipped()
    }

    private func placeholder(icon: String?) -> some View {
        ZStack {
            Theme.brand.opacity(0.12)
            if let icon { Image(systemName: icon).foregroundStyle(Theme.brand) } else { ProgressView() }
        }
    }
}

struct SectionHeader: View {
    var title: LocalizedStringResource
    var count: Int? = nil
    var body: some View {
        HStack {
            Text(title).font(.title3.bold()).lineLimit(1).minimumScaleFactor(0.8)
            if let count { Text(count, format: .number).font(.subheadline.weight(.semibold)).foregroundStyle(.secondary) }
            Spacer()
        }
        .padding(.top, 8)
    }
}

/// Section title with a trailing action; moves the action below the title when a translation is too long.
struct SectionHeaderWithAction<Action: View>: View {
    var title: LocalizedStringResource
    var count: Int? = nil
    @ViewBuilder var action: Action

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack {
                SectionHeader(title: title, count: count).fixedSize()
                Spacer(minLength: 8)
                action.fixedSize()
            }
            VStack(alignment: .leading, spacing: 8) {
                SectionHeader(title: title, count: count)
                action
            }
        }
    }
}

struct EmptyStateView: View {
    var icon: String
    var title: LocalizedStringResource
    var message: LocalizedStringResource
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 34)).foregroundStyle(Theme.brand)
            Text(title).font(.headline)
            Text(message).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(24)
        .card()
    }
}

/// Round "+" button for creating content inside a section.
struct AddButton: View {
    var label: LocalizedStringResource
    /// Stable, non-localized identifier for UI tests.
    var id: String
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            Label { Text(label).lineLimit(1) } icon: { Image(systemName: "plus") }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .frame(height: 36)
                .background(Theme.brand, in: Capsule())
        }
        .accessibilityIdentifier("add-\(id)")
    }
}

/// Presents `message` as an alert while it is non-nil.
struct ErrorAlert: ViewModifier {
    @Binding var message: String?
    func body(content: Content) -> some View {
        content.alert("Something went wrong", isPresented: Binding(
            get: { message != nil }, set: { if !$0 { message = nil } }
        )) {
            Button("OK", role: .cancel) { message = nil }
        } message: {
            Text(message ?? "")
        }
    }
}

extension View {
    func errorAlert(_ message: Binding<String?>) -> some View { modifier(ErrorAlert(message: message)) }
}

extension Date {
    var relativeShort: String { formatted(.relative(presentation: .named, unitsStyle: .abbreviated)) }
}
