import SwiftUI

/// Profile → Sign-in & security (docs/auth-security.md §8): change password, change email, your devices.
struct SecurityView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                SectionHeader(title: "Sign-in & security", hue: .indigo)
                ChangePasswordPanel()
                ChangeEmailPanel()
                DevicesSection()
                    .padding(.top, 8)
            }
            .padding(20)
        }
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(Text("Sign-in & security"))
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("security-screen")
    }
}

/// A collapsible card: a row button while idle, the form once opened.
private struct SecurityCard<Content: View>: View {
    var title: LocalizedStringResource
    var icon: String
    var hue: Hue
    var id: String
    @Binding var isOpen: Bool
    @ViewBuilder var content: Content
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Button {
                withAnimation(Motion.resolve(Motion.gentle, reduceMotion: reduceMotion)) { isOpen.toggle() }
            } label: {
                HStack(spacing: 12) {
                    FeatureBadge(icon: icon, hue: hue, size: 34)
                    Text(title).font(.body.weight(.semibold)).foregroundStyle(Theme.ink)
                    Spacer()
                    Image(systemName: "chevron.down").font(.subheadline.weight(.bold)).foregroundStyle(Theme.inkSecondary)
                        .rotationEffect(.degrees(isOpen ? 180 : 0))
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.squish)
            .accessibilityIdentifier(id)
            .accessibilityValue(isOpen ? Text("Expanded") : Text("Collapsed"))
            if isOpen { content.transition(.opacity) }
        }
        .card(padding: 14)
    }
}

private enum SecurityStep { case form, code }

/// Change password: new password → emailed `change_password` code → verify → `updateUser({ password })`.
private struct ChangePasswordPanel: View {
    @Environment(SessionStore.self) private var session
    @State private var open = false
    @State private var step: SecurityStep = .form
    @State private var password = ""
    @State private var code = ""
    @State private var sentAt: Date?
    @State private var busy = false
    @State private var error: String?
    @State private var done = false
    @State private var shakes = 0
    @State private var proven = false

    var body: some View {
        VStack(spacing: 10) {
            SecurityCard(title: "Change password", icon: "key.fill", hue: .indigo, id: "change-password", isOpen: $open) {
                if step == .form {
                    SecureField("New password", text: $password)
                        .textContentType(.newPassword)
                        .boolaaField()
                        .accessibilityIdentifier("change-password-field")
                    Text("At least 8 characters is best.").font(.footnote).foregroundStyle(Theme.inkSecondary)
                    Text("To confirm it's you, we'll send a code to \(session.email ?? "").").font(.subheadline).foregroundStyle(Theme.inkSecondary)
                    if let error { FormMessage(text: error) }
                    Button {
                        Task { await sendCode() }
                    } label: {
                        if busy { ProgressView() } else { Text("Send code") }
                    }
                    .buttonStyle(PrimaryButtonStyle(hue: .indigo, calm: true))
                    .disabled(busy || password.count < 6)
                    .shake(shakes)
                    .accessibilityIdentifier("password-send-code")
                } else {
                    Text("Enter the 6-digit code we sent to \(session.email ?? "").").font(.subheadline).foregroundStyle(Theme.inkSecondary)
                    CodeInput(code: $code, isInvalid: error != nil, isDisabled: busy) { value in Task { await save(value) } }
                        .shake(shakes)
                    if let error { FormMessage(text: error) }
                    HStack {
                        ResendCodeButton(sentAt: sentAt, busy: busy) { Task { await sendCode() } }
                        Spacer()
                        Button("Back") { step = .form; error = nil }.font(.subheadline.weight(.semibold)).disabled(busy)
                    }
                    Button {
                        Task { await save(code) }
                    } label: {
                        if busy { ProgressView() } else { Text("Save password") }
                    }
                    .buttonStyle(PrimaryButtonStyle(hue: .indigo, calm: true))
                    .disabled(busy || code.count != CodeInput.length)
                    .accessibilityIdentifier("password-save")
                }
            }
            if done {
                FormMessage(text: String(localized: "Your password has been changed."), kind: .notice)
                    .accessibilityIdentifier("password-changed")
            }
        }
        .sensoryFeedback(.error, trigger: shakes)
    }

    private func sendCode() async {
        busy = true; defer { busy = false }
        error = nil; done = false; proven = false
        do {
            try await session.requestPasswordChangeCode()
            sentAt = .now; code = ""; step = .code
        } catch { shakes += 1; self.error = error.userMessage }
    }

    private func save(_ value: String) async {
        guard !busy else { return }
        busy = true; defer { busy = false }
        error = nil
        do {
            if !proven {
                try await session.verifySensitiveActionCode(value)
                proven = true // a code works once: a retry after e.g. same_password reuses the proof
            }
            try await session.changePassword(password)
            Haptics.success()
            password = ""; code = ""; step = .form; open = false; done = true
        } catch { code = ""; shakes += 1; self.error = error.userMessage }
    }
}

/// Change email: a `sensitive_action` code first (the backend completes the change with one code, so this is the
/// gate), then `updateUser({ email })`. Both addresses then get an email to confirm.
private struct ChangeEmailPanel: View {
    @Environment(SessionStore.self) private var session
    @State private var open = false
    @State private var step: SecurityStep = .form
    @State private var newEmail = ""
    @State private var code = ""
    @State private var sentAt: Date?
    @State private var busy = false
    @State private var error: String?
    @State private var sentTo: String?
    @State private var shakes = 0

    private var trimmed: String { newEmail.trimmingCharacters(in: .whitespaces) }
    private var canSend: Bool { trimmed.contains("@") && trimmed.lowercased() != session.email?.lowercased() }

    var body: some View {
        VStack(spacing: 10) {
            SecurityCard(title: "Change email", icon: "envelope.fill", hue: .sky, id: "change-email", isOpen: $open) {
                if step == .form {
                    TextField("New email", text: $newEmail)
                        .textContentType(.emailAddress)
                        .keyboardType(.emailAddress)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .boolaaField()
                        .accessibilityIdentifier("change-email-field")
                    Text("First we'll send a code to your current email. After that, both addresses get an email to confirm the change.")
                        .font(.subheadline).foregroundStyle(Theme.inkSecondary)
                    if let error { FormMessage(text: error) }
                    Button {
                        Task { await sendCode() }
                    } label: {
                        if busy { ProgressView() } else { Text("Send code") }
                    }
                    .buttonStyle(PrimaryButtonStyle(hue: .indigo, calm: true))
                    .disabled(busy || !canSend)
                    .shake(shakes)
                    .accessibilityIdentifier("email-send-code")
                } else {
                    Text("Enter the 6-digit code we sent to \(session.email ?? "").").font(.subheadline).foregroundStyle(Theme.inkSecondary)
                    CodeInput(code: $code, isInvalid: error != nil, isDisabled: busy) { value in Task { await confirm(value) } }
                        .shake(shakes)
                    if let error { FormMessage(text: error) }
                    HStack {
                        ResendCodeButton(sentAt: sentAt, busy: busy) { Task { await sendCode() } }
                        Spacer()
                        Button("Back") { step = .form; error = nil }.font(.subheadline.weight(.semibold)).disabled(busy)
                    }
                    Button {
                        Task { await confirm(code) }
                    } label: {
                        if busy { ProgressView() } else { Text("Change email") }
                    }
                    .buttonStyle(PrimaryButtonStyle(hue: .indigo, calm: true))
                    .disabled(busy || code.count != CodeInput.length)
                    .accessibilityIdentifier("email-confirm")
                }
            }
            if let sentTo {
                FormMessage(text: String(localized: "Almost done: confirm the change from the emails we sent to your current address and to \(sentTo)."), kind: .notice)
                    .accessibilityIdentifier("email-change-sent")
            }
        }
        .sensoryFeedback(.error, trigger: shakes)
    }

    private func sendCode() async {
        busy = true; defer { busy = false }
        error = nil; sentTo = nil
        do {
            try await session.sendSensitiveActionCode(.changeEmail)
            sentAt = .now; code = ""; step = .code
        } catch { shakes += 1; self.error = error.userMessage }
    }

    private func confirm(_ value: String) async {
        guard !busy else { return }
        busy = true; defer { busy = false }
        error = nil
        do {
            try await session.verifySensitiveActionCode(value)
            try await session.changeEmail(trimmed)
            Haptics.success()
            sentTo = trimmed; newEmail = ""; code = ""; step = .form; open = false
        } catch { code = ""; shakes += 1; self.error = error.userMessage }
    }
}

/// "Your devices": `list_my_devices()`, "This device" by hash, revoke (with a confirmation) on the others.
private struct DevicesSection: View {
    @Environment(SessionStore.self) private var session
    @State private var devices: [TrustedDevice]?
    @State private var confirming: TrustedDevice?
    @State private var busy = false
    @State private var error: String?

    private var mine: String { session.device.hash }

    private var sorted: [TrustedDevice] {
        (devices ?? []).sorted { ($0.deviceHash == mine ? 0 : 1) < ($1.deviceHash == mine ? 0 : 1) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Your devices", count: devices?.count, hue: .indigo)
            Text("Browsers and phones you've signed in on. Remove one you don't recognise.")
                .font(.subheadline).foregroundStyle(Theme.inkSecondary)
            if let devices, devices.isEmpty, error == nil {
                Text("No devices yet.").font(.subheadline).foregroundStyle(Theme.inkSecondary)
            } else if devices == nil, error == nil {
                ProgressView().frame(maxWidth: .infinity)
            }
            ForEach(Array(sorted.enumerated()), id: \.element.id) { index, device in
                row(device).popIn(index)
            }
            if let error { FormMessage(text: error) }
        }
        .accessibilityIdentifier("devices")
        .task { await load() }
        .alert(
            Text("Remove \(confirming.map(name) ?? "")?"),
            isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }),
            presenting: confirming
        ) { device in
            Button("Cancel", role: .cancel) { confirming = nil }
            Button("Remove device", role: .destructive) { Task { await revoke(device) } }
        } message: { _ in
            Text("It will need a new code from your email before it can see your bubbles again.")
        }
    }

    private func name(_ device: TrustedDevice) -> String {
        device.label?.nilIfEmpty ?? String(localized: "Unknown device")
    }

    private func row(_ device: TrustedDevice) -> some View {
        let current = device.deviceHash == mine
        let label = name(device)
        let phone = label.range(of: "iOS|iPadOS|Android|iPhone|iPad|Pixel", options: .regularExpression) != nil
        return HStack(spacing: 12) {
            Image(systemName: phone ? "iphone" : "laptopcomputer")
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(Hue.indigo.text)
                .frame(width: 40, height: 40)
                .background(Hue.indigo.wash, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 6) { deviceName(label); if current { thisDeviceBadge } }
                    VStack(alignment: .leading, spacing: 4) { deviceName(label); if current { thisDeviceBadge } }
                }
                if let seen = device.lastSeenAt {
                    Text("Last active \(seen.formatted(.relative(presentation: .named)))")
                        .font(.caption).foregroundStyle(Theme.inkSecondary)
                }
            }
            Spacer(minLength: 4)
            if !current {
                Button {
                    confirming = device
                } label: {
                    Text("Remove").font(.subheadline.weight(.semibold))
                        .foregroundStyle(Theme.dangerText)
                        .padding(.horizontal, 12).frame(minHeight: 36)
                        .background(Theme.danger.opacity(0.1), in: Capsule())
                        .minimumHitTarget()
                }
                .buttonStyle(.squishIcon)
                .disabled(busy)
                .accessibilityLabel(Text("Remove \(label)"))
                .accessibilityIdentifier("revoke-device")
            }
        }
        .padding(12)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.Radius.field + 4, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.field + 4, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(current ? "device-row-current" : "device-row")
    }

    private func deviceName(_ label: String) -> some View {
        Text(verbatim: label).font(.body.weight(.semibold)).lineLimit(2)
    }

    private var thisDeviceBadge: some View {
        Text("This device")
            .font(.rounded(.caption, weight: .heavy))
            .foregroundStyle(Hue.mint.text)
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(Hue.mint.wash, in: Capsule())
            .fixedSize()
            .accessibilityIdentifier("this-device")
    }

    private func load() async {
        do {
            devices = try await session.api.listMyDevices()
            error = nil
        } catch {
            if devices == nil { devices = [] }
            self.error = error.userMessage
        }
    }

    private func revoke(_ device: TrustedDevice) async {
        busy = true; defer { busy = false }
        confirming = nil
        do {
            try await session.api.revokeDevice(hash: device.deviceHash)
            Haptics.success()
            await load()
        } catch { self.error = error.userMessage }
    }
}
