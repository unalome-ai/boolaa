import SwiftUI

/// Report flow: pick one of the 7 reasons, add optional details, send; then offer "Also block <name>?".
struct ReportSheet: View {
    var target: ReportTarget
    @Environment(\.dismiss) private var dismiss
    @Environment(SessionStore.self) private var session
    @Environment(SafetyStore.self) private var safety
    @State private var reason: ReportReason?
    @State private var details = ""
    @State private var busy = false
    @State private var sent = false
    @State private var error: String?

    static let maxDetails = 1000

    var body: some View {
        NavigationStack {
            Group {
                if sent { sentView } else { form }
            }
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(Text(target.type.reportTitle))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if !sent {
                    ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                }
            }
            .errorAlert($error)
        }
        .presentationDetents([.large])
    }

    private var form: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("Why are you reporting this?").font(.title3.weight(.bold))
                Text("Your report is private. \(target.authorName) won't know who sent it.",
                     comment: "Report sheet intro; the argument is the reported person's name")
                    .font(.subheadline).foregroundStyle(.secondary)

                VStack(spacing: 0) {
                    ForEach(ReportReason.allCases) { r in
                        Button { reason = r } label: {
                            HStack {
                                Text(r.label).foregroundStyle(.primary).multilineTextAlignment(.leading)
                                Spacer()
                                Image(systemName: reason == r ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(reason == r ? Theme.brand : Color.secondary)
                            }
                            .padding(.vertical, 12)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(reason == r ? .isSelected : [])
                        .accessibilityIdentifier("reason-\(r.rawValue)")
                        if r != ReportReason.allCases.last { Divider() }
                    }
                }
                .card()

                Text("Details (optional)").font(.caption.weight(.bold)).foregroundStyle(.secondary)
                TextField("Tell us what happened", text: $details, axis: .vertical)
                    .lineLimit(3...8)
                    .boolaaField()
                    .onChange(of: details) { _, new in
                        if new.count > Self.maxDetails { details = String(new.prefix(Self.maxDetails)) }
                    }
                    .accessibilityIdentifier("report-details")

                Button {
                    Task { await send() }
                } label: {
                    if busy { ProgressView().tint(.white) } else { Text("Send report") }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(reason == nil || busy)
                .accessibilityIdentifier("report-send")
            }
            .padding(20)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private var sentView: some View {
        ScrollView {
            VStack(spacing: 16) {
                Image(systemName: "checkmark.seal.fill").font(.system(size: 56)).foregroundStyle(Theme.brand)
                    .padding(.top, 32)
                Text("Thanks for letting us know").font(.title3.weight(.bold)).multilineTextAlignment(.center)
                Text("We'll review your report and take action if it breaks the rules.")
                    .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)

                if !safety.isBlocked(target.authorID) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Also block \(target.authorName)?", comment: "Offered after a report; the argument is a person's name")
                            .font(.headline)
                        Text("You won't see each other's messages, events, posts or links. You can unblock them in your profile.")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .card()
                    .padding(.top, 8)

                    Button {
                        Task { await safety.block(target.authorID); dismiss() }
                    } label: {
                        Text("Block \(target.authorName)", comment: "Menu action; the argument is a person's name")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .accessibilityIdentifier("report-block")
                    Button("Not now") { dismiss() }
                        .buttonStyle(SecondaryButtonStyle())
                } else {
                    Button("Done") { dismiss() }.buttonStyle(PrimaryButtonStyle())
                }
            }
            .padding(20)
        }
    }

    private func send() async {
        guard let reason else { return }
        busy = true; defer { busy = false }
        do {
            _ = try await session.api.report(target, reason: reason, details: details)
            withAnimation { sent = true }
        } catch { self.error = error.userMessage }
    }
}
