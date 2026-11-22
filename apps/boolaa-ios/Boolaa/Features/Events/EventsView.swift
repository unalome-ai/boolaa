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
                SectionHeaderWithAction(title: "My events", count: mine.count) {
                    AddButton(label: "New event", id: "new-event") { editing = .new }
                }
                if model.loaded && mine.isEmpty {
                    EmptyStateView(icon: "calendar.badge.plus", title: "No events from you", message: "Plan something for the bubble.")
                }
                ForEach(mine) { event in
                    EventCard(event: event, myID: session.userID,
                              onRSVP: { Task { await model.toggleRSVP(api: session.api, event: event) } },
                              onEdit: { editing = .edit(event) },
                              onDelete: { Task { await model.delete(api: session.api, event: event) } })
                }

                SectionHeader(title: "Bubble events", count: others.count)
                if model.loaded && others.isEmpty {
                    EmptyStateView(icon: "calendar", title: "Nothing planned", message: "Events from other members show up here.")
                }
                ForEach(others) { event in
                    EventCard(event: event, myID: session.userID,
                              onRSVP: { Task { await model.toggleRSVP(api: session.api, event: event) } })
                        .safetyContextMenu(.event(event))
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, Theme.tabBarClearance)
        }
        .refreshable { await reload() }
        .task { await reload() }
        .sheet(item: $editing) { target in
            EventEditor(target: target) { Task { await reload() } }
        }
        .errorAlert($model.error)
    }

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

    private var going: Bool { myID.map(event.rsvpList.contains) ?? false }

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(spacing: 0) {
                Text(event.datetime.formatted(.dateTime.month(.abbreviated)).uppercased(with: .current))
                    .font(.caption.weight(.bold)).foregroundStyle(.white)
                    .frame(maxWidth: .infinity).padding(.vertical, 3)
                    .background(Theme.brand)
                Text(event.datetime.formatted(.dateTime.day()))
                    .font(.title2.weight(.bold)).foregroundStyle(Theme.brand)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .frame(width: 54, height: 60)
            .background(Theme.brand.opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

            VStack(alignment: .leading, spacing: 5) {
                HStack(alignment: .top) {
                    Text(verbatim: event.title).font(.headline)
                    Spacer()
                    if onEdit != nil {
                        Menu {
                            Button("Edit", systemImage: "pencil") { onEdit?() }
                            Button("Delete", systemImage: "trash", role: .destructive) { confirmDelete = true }
                        } label: {
                            Image(systemName: "ellipsis").foregroundStyle(.secondary).frame(width: 28, height: 24)
                        }
                        .accessibilityLabel(Text("More actions"))
                        .accessibilityIdentifier("event-menu")
                    }
                }
                Label(event.datetime.formatted(date: .abbreviated, time: .shortened), systemImage: "clock")
                    .font(.subheadline).foregroundStyle(.secondary)
                if let location = event.location?.nilIfEmpty {
                    Label { Text(verbatim: location) } icon: { Image(systemName: "mappin.and.ellipse") }.font(.subheadline).foregroundStyle(.secondary)
                }
                if let description = event.description?.nilIfEmpty {
                    Text(verbatim: description).font(.subheadline)
                }
                HStack {
                    if let creator = event.creator {
                        AvatarView(user: creator, size: 22)
                        Text(verbatim: creator.displayName).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                    Spacer()
                    Text("\(event.rsvpList.count) going", comment: "Number of people who RSVPed to an event")
                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                .padding(.top, 4)
                HStack {
                    Spacer()
                    Button(action: onRSVP) {
                        HStack(spacing: 6) {
                            Image(systemName: going ? "checkmark.circle.fill" : "plus.circle")
                            Text(going ? LocalizedStringResource("Going", comment: "RSVP button when you are attending")
                                       : LocalizedStringResource("RSVP", comment: "RSVP button when you are not attending"))
                                .lineLimit(1)
                        }
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(going ? .white : Theme.brand)
                        .padding(.horizontal, 12).frame(height: 32)
                        .background(Capsule().fill(going ? Theme.brand : Theme.brand.opacity(0.12)))
                    }
                    .buttonStyle(.plain)
                    .fixedSize()
                    .accessibilityValue(going ? Text("Going") : Text(verbatim: ""))
                    .accessibilityIdentifier("rsvp-\(event.title)")
                }
            }
        }
        .card()
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
            Form {
                Section {
                    TextField("Title", text: $title).accessibilityIdentifier("event-title")
                    TextField("Description", text: $description, axis: .vertical).lineLimit(2...5)
                }
                Section {
                    DatePicker("Date & time", selection: $date)
                    TextField("Location", text: $location)
                }
            }
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
