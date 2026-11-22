import SwiftUI

/// "Download my data" (GDPR export): what's in the file and that a code comes first, then an emailed `export_data`
/// code, then `data-export` in the same session and "Save to Files". Calm, like the other security sheets.
struct ExportDataSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(SessionStore.self) private var session
    @State private var step: Step = .intro
    @State private var busy = false
    @State private var error: String?
    @State private var code = ""
    @State private var sentAt: Date?
    @State private var shakes = 0
    /// The export, kept until the sheet closes: one export an hour, so a cancelled "Save" can be retried.
    @State private var file: DataExportFile?
    @State private var showExporter = false

    private enum Step { case intro, code, preparing, ready }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Image(systemName: "arrow.down.doc.fill").font(.system(size: 44)).foregroundStyle(Theme.brandText)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 12)
                        .accessibilityHidden(true)
                    switch step {
                    case .intro: intro
                    case .code: codeStep
                    case .preparing: preparing
                    case .ready: ready
                    }
                }
                .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle("Download your data")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if step == .ready { Button("Done") { dismiss() } } else { Button("Cancel") { dismiss() }.disabled(busy) }
                }
            }
            .interactiveDismissDisabled(busy)
            .sensoryFeedback(.error, trigger: shakes)
            .fileExporter(isPresented: $showExporter, document: file.map { DataExportDocument(data: $0.data) },
                          contentType: .json, defaultFilename: file?.filename) { result in
                if case .failure(let failure) = result { error = failure.userMessage }
            }
        }
    }

    private var intro: some View {
        Group {
            Text("You get one JSON file with everything Boolaa stores about you: your profile, bubbles, messages, posts, reactions, reports, blocks and settings. Your photos are listed as links that work for 7 days. Keep the file private.")
            Text("To keep it safe, we'll email you a code first. You can download your data once an hour.")
                .font(.subheadline).foregroundStyle(.secondary)
            if let error { FormMessage(text: error) }
            Button {
                Task { await sendCode() }
            } label: {
                if busy { ProgressView() } else { Text("Send code") }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(busy)
            .accessibilityIdentifier("export-data-send")
        }
    }

    private var codeStep: some View {
        Group {
            Text("Enter the 6-digit code we sent to \(session.email ?? "").")
                .font(.subheadline.weight(.semibold))
                .accessibilityIdentifier("export-code-sent")
            CodeInput(code: $code, isInvalid: error != nil, isDisabled: busy) { value in Task { await verifyAndExport(value) } }
                .shake(shakes)
            if let error { FormMessage(text: error) }
            ResendCodeButton(sentAt: sentAt, busy: busy) { Task { await sendCode() } }
            Button {
                Task { await verifyAndExport(code) }
            } label: {
                if busy { ProgressView() } else { Text("Download my data") }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(code.count != CodeInput.length || busy)
            .accessibilityIdentifier("export-data-verify")
        }
    }

    private var preparing: some View {
        HStack(spacing: 10) {
            ProgressView()
            Text("Preparing your data…").foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("export-data-preparing")
    }

    private var ready: some View {
        Group {
            FormMessage(text: String(localized: "Your data is ready."), kind: .notice)
                .accessibilityIdentifier("export-data-done")
            if let error { FormMessage(text: error) }
            Button("Save") { error = nil; showExporter = true }
                .buttonStyle(PrimaryButtonStyle())
                .accessibilityIdentifier("export-data-save")
        }
    }

    private func sendCode() async {
        busy = true; defer { busy = false }
        error = nil
        do {
            try await session.sendSensitiveActionCode(.exportData)
            sentAt = .now; code = ""; step = .code
        } catch { shakes += 1; self.error = error.userMessage }
    }

    private func verifyAndExport(_ value: String) async {
        guard !busy else { return }
        busy = true; defer { busy = false }
        error = nil
        do {
            try await session.verifySensitiveActionCode(value)
        } catch {
            code = ""; shakes += 1; self.error = error.userMessage
            return
        }
        step = .preparing
        do {
            file = try await session.exportMyData()
            step = .ready
            showExporter = true
        } catch {
            // Any failure (reauthentication_required, rate limit, expired session…) goes back to "Send code".
            // "session not verified" also re-runs the device gate (UserFacingError.classify posts the event).
            self.error = error.userMessage
            shakes += 1; code = ""; sentAt = nil; step = .intro
        }
    }
}
