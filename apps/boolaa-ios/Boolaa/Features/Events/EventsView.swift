import SwiftUI

@MainActor
@Observable
final class EventsModel {
    var events: [BubbleEvent] = []
    var loaded = false
    var error: String?

    func load(api: BoolaaAPI, bubbleID: UUID) async {
        do { events = try await api.events(bubbleID: bubbleID) } catch { self.error = error.userMessage }
        loaded = true
    }

    /// Other members' inserts, edits and deletes stream in until the view goes away (docs/boolaa-spec.md, Realtime tables).
    func listen(api: BoolaaAPI, bubbleID: UUID) async {
        await LiveFeed.observe(BubbleEvent.self, api: api, bubbleID: bubbleID,
                               rows: { [weak self] in self?.events ?? [] },
                               apply: { [weak self] in self?.events = $0 },
                               reload: { [weak self] in await self?.load(api: api, bubbleID: bubbleID) })
    }

    func toggleRSVP(api: BoolaaAPI, event: BubbleEvent) async {
        do {
            let list = try await api.toggleRSVP(eventID: event.id)
            if let idx = events.firstIndex(where: { $0.id == event.id }) { events[idx].rsvpList = list }
        } catch { self.error = error.userMessage }
    }

    func delete(api: BoolaaAPI, event: BubbleEvent) async {
        do {
            try await api.deleteEvent(id: event.id)
            events.removeAll { $0.id == event.id }
        } catch { self.error = error.userMessage }
    }
}

/// "My events" and "Bubble events", sorted by date, with RSVP (spec §7).
struct EventsView: View {
    @Environment(SessionStore.self) private var session
    @State private var model = EventsModel()
    @State private var editing: EventEditorTarget?

    private var mine: [BubbleEvent] { model.events.filter { $0.creatorId == session.userID }.sorted { $0.datetime < $1.datetime } }
    private var others: [BubbleEvent] { model.events.filter { $0.creatorId != session.userID }.sorted { $0.datetime < $1.datetime } }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                SectionHeaderWithAction(title: "My events", count: mine.count, hue: hue) {
                    AddButton(label: "New event", id: "new-event", hue: hue) { editing = .new }
                }
                if !model.loaded { SkeletonList(count: 2) }
                if model.loaded && mine.isEmpty {
                    EmptyStateView(icon: "calendar.badge.plus", title: "No events from you", message: "Plan something for the bubble.", hue: hue)
                }
                ForEach(Array(mine.enumerated()), id: \.element.id) { index, event in
                    EventCard(event: event, myID: session.userID,
                              onRSVP: { Task { await model.toggleRSVP(api: session.api, event: event) } },
                              onEdit: { editing = .edit(event) },
                              onDelete: { Task { await model.delete(api: session.api, event: event) } })
                        .popIn(index)
                }

                SectionHeader(title: "Bubble events", count: others.count, hue: hue)
                if model.loaded && others.isEmpty {
                    EmptyStateView(icon: "calendar", title: "Nothing planned", message: "Events from other members show up here.", hue: hue)
                }
                ForEach(Array(others.enumerated()), id: \.element.id) { index, event in
                    EventCard(event: event, myID: session.userID,
                              onRSVP: { Task { await model.toggleRSVP(api: session.api, event: event) } })
                        .safetyContextMenu(.event(event))
                        .popIn(index + mine.count)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
            .padding(.bottom, Theme.tabBarClearance)
            .animation(Motion.gentle, value: model.events.map(\.id))
        }
        .refreshFeedback { await reload() }
        .task {
            await reload()
            if let id = session.currentBubble?.id { await model.listen(api: session.api, bubbleID: id) }
        }
        .sheet(item: $editing) { target in
            EventEditor(target: target) { Task { await reload() } }.boolaaSheet()
        }
        .errorAlert($model.error)
    }

    private var hue: Hue { Feature.events.hue }

    private func reload() async {
        guard let id = session.currentBubble?.id else { return }
        await model.load(api: session.api, bubbleID: id)
    }
}

enum EventEditorTarget: Identifiable {
    case new
    case edit(BubbleEvent)
    var id: String { if case .edit(let e) = self { e.id.uuidString } else { "new" } }
}

struct EventCard: View {
    var event: BubbleEvent
    var myID: UUID?
    var onRSVP: () -> Void
    var onEdit: (() -> Void)? = nil
    var onDelete: (() -> Void)? = nil
    @State private var confirmDelete = false
    @State private var taps = 0
    @State private var bursts = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var going: Bool { myID.map(event.rsvpList.contains) ?? false }
    @ScaledMetric(relativeTo: .title2) private var tileWidth: CGFloat = 56
    @ScaledMetric(relativeTo: .title2) private var tileHeight: CGFloat = 64

    @ViewBuilder private var creatorLabel: some View {
        if let creator = event.creator {
            AvatarView(user: creator, size: 24)
            Text(verbatim: creator.displayName).font(.caption.weight(.medium)).foregroundStyle(.secondary).lineLimit(1)
        }
    }

    private var goingCount: some View {
        Text("\(event.rsvpList.count) going", comment: "Number of people who RSVPed to an event")
            .font(.rounded(.caption, weight: .semibold)).monospacedDigit()
            .foregroundStyle(.secondary).lineLimit(1)
            .contentTransition(.numericText(value: Double(event.rsvpList.count)))
    }

    private var rsvpButton: some View {
        let hue = Feature.events.hue
        return Button {
            taps += 1
            onRSVP()
        } label: {
            HStack(spacing: 6) {
                Image(systemName: going ? "checkmark.circle.fill" : "plus.circle.fill")
                    .contentTransition(.symbolEffect(.replace))
                Text(going ? LocalizedStringResource("Going", comment: "RSVP button when you are attending")
                           : LocalizedStringResource("RSVP", comment: "RSVP button when you are not attending"))
                    .lineLimit(1)
            }
            .font(.rounded(.subheadline))
            .foregroundStyle(going ? Hue.mint.onFill : hue.text)
            .padding(.horizontal, 14).frame(minHeight: 38)
            .background {
                if going {
                    Capsule().fill(Hue.mint.gradient).shadow(color: Hue.mint.fill.opacity(0.4), radius: 8, y: 4)
                } else {
                    Capsule().fill(hue.wash)
                }
            }
        }
        .buttonStyle(.squish)
        .fixedSize()
        .overlay { ConfettiBurst(trigger: bursts) }
        .accessibilityValue(going ? Text("Going") : Text(verbatim: ""))
        .accessibilityIdentifier("rsvp-\(event.title)")
    }

    var body: some View {
        let hue = Feature.events.hue
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 14) {
                // Calendar-page tile, tipped a little like a sticker.
                VStack(spacing: 0) {
                    Text(event.datetime.formatted(.dateTime.month(.abbreviated)).uppercased(with: .current))
                        .font(.rounded(.caption2, weight: .heavy)).foregroundStyle(hue.onFill)
                        .lineLimit(1).minimumScaleFactor(0.7)
                        .frame(maxWidth: .infinity).padding(.vertical, 4).padding(.horizontal, 2)
                        .background(hue.gradient)
                    Text(event.datetime.formatted(.dateTime.day()))
                        .font(.rounded(.title2, weight: .heavy)).foregroundStyle(hue.text)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .frame(width: min(tileWidth, 84), height: min(tileHeight, 96))
                .background(hue.wash)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .rotationEffect(.degrees(-4))
                .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 5) {
                    HStack(alignment: .top) {
                        Text(verbatim: event.title).font(.rounded(.headline))
                        Spacer()
                        if onEdit != nil {
                            Menu {
                                Button("Edit", systemImage: "pencil") { onEdit?() }
                                Button("Delete", systemImage: "trash", role: .destructive) { confirmDelete = true }
                            } label: {
                                Image(systemName: "ellipsis").font(.body.weight(.bold)).foregroundStyle(.secondary).frame(width: 32, height: 28)
                            }
                            .accessibilityLabel(Text("More actions"))
                            .accessibilityIdentifier("event-menu")
                        }
                    }
                    Label(event.datetime.formatted(date: .abbreviated, time: .shortened), systemImage: "clock.fill")
                        .font(.subheadline).foregroundStyle(.secondary)
                    if let location = event.location?.nilIfEmpty {
                        Label { Text(verbatim: location) } icon: { Image(systemName: "mappin.circle.fill") }.font(.subheadline).foregroundStyle(.secondary)
                    }
                    if let description = event.description?.nilIfEmpty {
                        Text(verbatim: description).font(.subheadline).padding(.top, 2)
                    }
                }
            }
            // Footer: one row when it fits, two when the text is large or the translation long.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) {
                    creatorLabel
                    Spacer(minLength: 4)
                    goingCount
                    rsvpButton
                }
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 8) {
                        creatorLabel
                        Spacer(minLength: 4)
                        goingCount
                    }
                    rsvpButton
                }
            }
        }
        .card()
        .animation(Motion.resolve(Motion.bouncy, reduceMotion: reduceMotion), value: going)
        .animation(Motion.snappy, value: event.rsvpList.count)
        .onChange(of: going) { _, now in
            if now { bursts += 1 }
        }
        .sensoryFeedback(.impact(weight: .light), trigger: taps)
        .sensoryFeedback(.success, trigger: bursts)
        .confirmationDialog(Text("Delete “\(event.title)”?", comment: "Confirmation title; the argument is the event title"), isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { onDelete?() }
        }
    }
}

struct EventEditor: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(SessionStore.self) private var session
    var target: EventEditorTarget
    var onSaved: () -> Void

    @State private var title = ""
    @State private var description = ""
    @State private var date = Calendar.current.date(byAdding: .day, value: 1, to: .now) ?? .now
    @State private var location = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    BubbleCluster(icon: "calendar", hue: Feature.events.hue, size: 72)
                        .padding(.vertical, 8)
                    TextField("Title", text: $title).boolaaField().accessibilityIdentifier("event-title")
                    TextField("Description", text: $description, axis: .vertical).lineLimit(2...5)
                        .padding(.vertical, 12).boolaaField()
                    DatePicker("Date & time", selection: $date)
                        .padding(.horizontal, 16).frame(minHeight: 52)
                        .background(Theme.field, in: RoundedRectangle(cornerRadius: Theme.Radius.field, style: .continuous))
                    TextField("Location", text: $location).boolaaField()
                }
                .padding(20)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Theme.background.ignoresSafeArea())
            .navigationTitle(isNew ? "New event" : "Edit event")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }
                        .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty || busy)
                        .accessibilityIdentifier("event-save")
                }
            }
            .onAppear {
                if case .edit(let e) = target {
                    title = e.title; description = e.description ?? ""; date = e.datetime; location = e.location ?? ""
                }
            }
            .errorAlert($error)
        }
    }

    private var isNew: Bool { if case .new = target { true } else { false } }

    private func save() async {
        guard let bubbleID = session.currentBubble?.id, let me = session.userID else { return }
        busy = true; defer { busy = false }
        var input = EventInput(title: title.trimmingCharacters(in: .whitespaces),
                               description: description.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty,
                               datetime: date,
                               location: location.trimmingCharacters(in: .whitespaces).nilIfEmpty)
        do {
            switch target {
            case .new:
                input.bubbleId = bubbleID; input.creatorId = me
                try await session.api.createEvent(input)
            case .edit(let e):
                try await session.api.updateEvent(id: e.id, input)
            }
            onSaved()
            dismiss()
        } catch { self.error = error.userMessage }
    }
}
