import SwiftUI

/// Create a bubble: name, description, max size (spec §3).
struct CreateBubbleForm: View {
    @Environment(SessionStore.self) private var session
    var onDone: () -> Void = {}
    @State private var name = DebugHooks.string("UITestBubbleName") ?? ""
    @State private var description = DebugHooks.string("UITestBubbleDescription") ?? ""
    @State private var maxSize = 12
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            TextField("Bubble name", text: $name)
                .boolaaField()
                .accessibilityIdentifier("create-bubble-name")
            TextField("Description (optional)", text: $description, axis: .vertical)
                .lineLimit(2...4)
                .padding(.vertical, 12)
                .boolaaField()
            Stepper(value: $maxSize, in: 2...150) {
                HStack {
                    Text("Max members")
                    Spacer()
                    Text(maxSize, format: .number)
                        .font(.rounded(.title3, weight: .heavy)).monospacedDigit()
                        .foregroundStyle(Theme.brandText)
                        .contentTransition(.numericText(value: Double(maxSize)))
                        .animation(Motion.snappy, value: maxSize)
                }
            }
            .padding(.horizontal, 16).frame(minHeight: 52)
            .background(Theme.field, in: RoundedRectangle(cornerRadius: Theme.Radius.field, style: .continuous))
            .sensoryFeedback(.selection, trigger: maxSize)

            Button {
                Task {
                    busy = true; defer { busy = false }
                    do {
                        try await session.createBubble(
                            name: name.trimmingCharacters(in: .whitespaces),
                            description: description.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
                            maxSize: maxSize)
                        onDone()
                    } catch { self.error = error.userMessage }
                }
            } label: {
                if busy { ProgressView() } else { Text("Create bubble") }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || name.count > 60 || busy)
            .accessibilityIdentifier("create-bubble-submit")
        }
        .errorAlert($error)
    }
}

/// Join a bubble with an invite code (spec §3).
struct JoinBubbleForm: View {
    @Environment(SessionStore.self) private var session
    var onRequested: (JoinRequest) -> Void = { _ in }
    @State private var code = DebugHooks.string("UITestJoinCode") ?? ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            TextField(text: $code, prompt: Text("Invite code")) { Text("Invite code") }
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .font(.body.monospaced())
                .boolaaField()
                .accessibilityIdentifier("join-code")
            Text("For example: \("FLAT2026")", comment: "Hint under the invite code field; the argument is an example code")
                .font(.caption).foregroundStyle(Theme.inkSecondary)
            Button {
                Task {
                    busy = true; defer { busy = false }
                    do {
                        let request = try await session.requestToJoin(code: code)
                        code = ""
                        onRequested(request)
                    } catch { self.error = error.userMessage }
                }
            } label: {
                if busy { ProgressView() } else { Text("Request to join") }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(code.trimmingCharacters(in: .whitespaces).isEmpty || busy)
            .accessibilityIdentifier("join-submit")
        }
        .errorAlert($error)
    }
}

extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
