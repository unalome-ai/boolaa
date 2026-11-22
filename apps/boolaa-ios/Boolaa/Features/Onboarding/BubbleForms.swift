import SwiftUI

/// Create a bubble: name, description, max size (spec §3).
struct CreateBubbleForm: View {
    @Environment(SessionStore.self) private var session
    var onDone: () -> Void = {}
    @State private var name = ""
    @State private var description = ""
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
                    Text(maxSize, format: .number).foregroundStyle(Theme.brand).bold()
                }
            }
            .padding(.horizontal, 14).frame(minHeight: 48)
            .background(Theme.field, in: RoundedRectangle(cornerRadius: 12, style: .continuous))

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
                if busy { ProgressView().tint(.white) } else { Text("Create bubble") }
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
    @State private var code = ""
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
                .font(.caption).foregroundStyle(.secondary)
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
                if busy { ProgressView().tint(.white) } else { Text("Request to join") }
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
