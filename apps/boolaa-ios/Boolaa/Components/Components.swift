import SwiftUI

/// Circular avatar. People without a photo get their initials on a colour picked from their name.
struct AvatarView: View {
    var url: URL?
    var name: String
    var size: CGFloat = 40
    /// What the placeholder colour is derived from: the user's id when known, else the name.
    var colorSeed: String? = nil

    private var hue: Hue { Hue.forSeed(colorSeed ?? name) }

    var body: some View {
        ZStack {
            Circle().fill(hue.gradient)
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
        .overlay(Circle().strokeBorder(Theme.card, lineWidth: size >= 32 ? 2 : 1.5))
        .accessibilityLabel(Text("Avatar of \(name)", comment: "Accessibility label; the argument is a person's name"))
    }

    private var initials: some View {
        Text(Self.initials(for: name))
            .font(.system(size: size * 0.38, weight: .bold, design: .rounded))
            .foregroundStyle(hue.onFill)
    }

    nonisolated static func initials(for name: String) -> String {
        // First letter (or digit) of the first two words that have one, so "Ana (Flat 4B)" or
        // "Ion - Pop" don't show punctuation; emoji-only names still fall back to their first character.
        let words = name.split(whereSeparator: { $0.isWhitespace })
        let firsts = words.compactMap { $0.first(where: { $0.isLetter || $0.isNumber }) }
        let picked = firsts.isEmpty ? words.compactMap(\.first) : firsts
        let letters = picked.prefix(2).map { String($0).uppercased() }.joined()
        return letters.isEmpty ? "?" : letters
    }
}

extension AvatarView {
    init(user: UserProfile?, size: CGFloat = 40) {
        self.init(url: user?.avatarURL, name: user?.displayName ?? "?", size: size, colorSeed: user?.id.uuidString.lowercased())
    }
}

/// Capsule chip used for filters and tags.
/// `title` is shown verbatim: pass `String(localized:)` for UI text, raw names for user content.
struct ChipView: View {
    var title: String
    var isActive: Bool
    var systemImage: String? = nil
    var outlined = false
    var hue: Hue = .grape

    var body: some View {
        HStack(spacing: 5) {
            if let systemImage { Image(systemName: systemImage).font(.system(size: 13, weight: .heavy)) }
            Text(verbatim: title).font(.rounded(.subheadline)).lineLimit(1)
        }
        .foregroundStyle(isActive ? hue.onFill : (outlined ? hue.text : Theme.inkSecondary))
        .padding(.horizontal, 16)
        .frame(minHeight: 38)
        .background {
            if isActive {
                Capsule().fill(hue.gradient).shadow(color: hue.fill.opacity(0.3), radius: 6, y: 3)
            } else if outlined {
                Capsule().strokeBorder(hue.text.opacity(0.55), style: StrokeStyle(lineWidth: 1.5, dash: [5, 4]))
            } else {
                Capsule().fill(Theme.chipInactive)
            }
        }
        .contentShape(Capsule())
    }
}

/// Remote image that fills its frame.
struct RemoteImage: View {
    var url: String?
    var hue: Hue = .grape
    var body: some View {
        AsyncImage(url: url.flatMap(URL.init(string:)), transaction: Transaction(animation: Motion.fade)) { phase in
            switch phase {
            case .success(let image): image.resizable().scaledToFill().transition(.opacity)
            case .failure: placeholder(icon: "photo")
            default: placeholder(icon: nil)
            }
        }
        .clipped()
    }

    private func placeholder(icon: String?) -> some View {
        ZStack {
            hue.wash
            if let icon { Image(systemName: icon).foregroundStyle(hue.text) } else { Color.clear.modifier(Shimmer()) }
        }
    }
}

struct SectionHeader: View {
    var title: LocalizedStringResource
    var count: Int? = nil
    var hue: Hue = .grape
    var body: some View {
        HStack(spacing: 8) {
            Text(title).font(.rounded(.title3, weight: .heavy)).lineLimit(1).minimumScaleFactor(0.8)
                .accessibilityAddTraits(.isHeader)
            if let count {
                Text(count, format: .number)
                    .font(.rounded(.footnote))
                    .monospacedDigit()
                    .contentTransition(.numericText(value: Double(count)))
                    .foregroundStyle(hue.text)
                    .padding(.horizontal, 9).padding(.vertical, 3)
                    .background(hue.wash, in: Capsule())
                    .animation(Motion.snappy, value: count)
            }
            Spacer()
        }
        .padding(.top, 8)
    }
}

/// Section title with a trailing action; moves the action below the title when a translation is too long.
struct SectionHeaderWithAction<Action: View>: View {
    var title: LocalizedStringResource
    var count: Int? = nil
    var hue: Hue = .grape
    @ViewBuilder var action: Action

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack {
                SectionHeader(title: title, count: count, hue: hue).fixedSize()
                Spacer(minLength: 8)
                action.fixedSize()
            }
            VStack(alignment: .leading, spacing: 8) {
                SectionHeader(title: title, count: count, hue: hue)
                action
            }
        }
    }
}

/// Friendly empty state: a floating bubble cluster, a title and one warm line.
struct EmptyStateView: View {
    var icon: String
    var title: LocalizedStringResource
    var message: LocalizedStringResource
    var hue: Hue = .grape
    var body: some View {
        VStack(spacing: 8) {
            BubbleCluster(icon: icon, hue: hue, size: 84)
                .padding(.bottom, 8)
            Text(title).font(.rounded(.headline)).multilineTextAlignment(.center)
            Text(message).font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 24)
        .padding(.vertical, 28)
        .background(hue.wash.opacity(0.6), in: RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
            .strokeBorder(hue.text.opacity(0.25), style: StrokeStyle(lineWidth: 1.5, dash: [6, 6])))
        .accessibilityElement(children: .combine)
        .popIn()
    }
}

/// Pill "+" button for creating content inside a section.
struct AddButton: View {
    var label: LocalizedStringResource
    /// Stable, non-localized identifier for UI tests.
    var id: String
    var hue: Hue = .grape
    var action: () -> Void
    @State private var taps = 0
    var body: some View {
        Button {
            taps += 1
            action()
        } label: {
            Label { Text(label).lineLimit(1) } icon: {
                Image(systemName: "plus").fontWeight(.heavy).symbolEffect(.bounce, value: taps)
            }
            .font(.rounded(.subheadline))
            .foregroundStyle(hue.onFill)
            .padding(.horizontal, 16)
            .frame(minHeight: 40)
            .background(hue.gradient, in: Capsule())
            .shadow(color: hue.fill.opacity(0.35), radius: 8, y: 4)
        }
        .buttonStyle(.squish)
        .sensoryFeedback(.impact(weight: .light), trigger: taps)
        .accessibilityIdentifier("add-\(id)")
    }
}

/// Back button and large title for pushed screens (Chat, Links).
struct PushedHeader<Subtitle: View>: View {
    var title: LocalizedStringResource
    var backID: String
    var onBack: () -> Void
    @ViewBuilder var subtitle: Subtitle

    var body: some View {
        HStack(spacing: 12) {
            Button(action: onBack) {
                Image(systemName: "chevron.left").font(.system(size: 17, weight: .heavy))
                    .foregroundStyle(Theme.brandText)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(Theme.card))
                    .cardChrome(radius: 22)
            }
            .buttonStyle(.squishIcon)
            .accessibilityLabel("Back")
            .accessibilityIdentifier(backID)
            VStack(alignment: .leading, spacing: 0) {
                Text(title).font(.rounded(.title, weight: .heavy)).lineLimit(1).minimumScaleFactor(0.7)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("screen-title")
                subtitle
            }
            Spacer()
        }
    }
}

/// A bubble's photo in a circle (filled and clipped, the upload isn't cropped), or, without one, the glossy
/// orb in the bubble's own colour with its initials once there is room for them.
struct BubbleLogo: View {
    var id: UUID?
    var name: String
    var logo: String?
    var size: CGFloat = 40

    var body: some View {
        let hue = Hue.forID(id)
        ZStack {
            BubbleOrb(hue: hue)
            if size >= 28 { initials(hue) }
            if let url = logo.flatMap(URL.init(string:)) {
                AsyncImage(url: url, transaction: Transaction(animation: Motion.fade)) { phase in
                    if let image = phase.image { image.resizable().scaledToFill().transition(.opacity) } else { Color.clear }
                }
                .clipShape(Circle())
            }
        }
        .frame(width: size, height: size)
        .accessibilityElement()
        .accessibilityLabel(Text("Photo of \(name)", comment: "Accessibility label of a bubble's photo; the argument is the bubble name"))
        .accessibilityHidden(logo == nil)
    }

    private func initials(_ hue: Hue) -> some View {
        Text(verbatim: AvatarView.initials(for: name))
            .font(.system(size: size * 0.36, weight: .heavy, design: .rounded))
            .foregroundStyle(hue.onFill)
            .accessibilityHidden(true)
    }
}

extension BubbleLogo {
    init(bubble: Bubble, size: CGFloat = 40) { self.init(id: bubble.id, name: bubble.name, logo: bubble.logo, size: size) }
}

/// Small bubble dot plus the bubble's name, in the bubble's colour.
struct BubbleNameTag: View {
    var bubble: Bubble?
    var body: some View {
        let hue = Hue.forID(bubble?.id)
        HStack(spacing: 5) {
            BubbleLogo(id: bubble?.id, name: bubble?.name ?? "", logo: bubble?.logo, size: 14)
            Text(verbatim: bubble?.name ?? "").font(.rounded(.subheadline, weight: .semibold)).foregroundStyle(hue.text).lineLimit(1)
        }
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

/// Pull to refresh with a soft success tap when the reload finishes.
private struct RefreshFeedback: ViewModifier {
    var action: @MainActor () async -> Void
    @State private var finished = 0
    func body(content: Content) -> some View {
        content
            .refreshable {
                await action()
                finished += 1
            }
            .sensoryFeedback(.success, trigger: finished)
    }
}

extension View {
    func refreshFeedback(_ action: @escaping @MainActor () async -> Void) -> some View {
        modifier(RefreshFeedback(action: action))
    }

    func errorAlert(_ message: Binding<String?>) -> some View { modifier(ErrorAlert(message: message)) }
}

extension Date {
    var relativeShort: String { formatted(.relative(presentation: .named, unitsStyle: .abbreviated)) }
}
