import SwiftUI

@MainActor
@Observable
final class EventsModel: CacheFirstModel {
    var events: [BubbleEvent] = []
    var loaded = false
    var failed = false
    var error: String?
    let reactions = ReactionStore(.event)

    /// The cached view first (offline / slow network), then the server's list.
    func load(api: BoolaaAPI, bubbleID: UUID) async {
        let ok = await loadCacheFirst(key: OfflineCache.Key.events(bubbleID),
                                      apply: { (rows: [BubbleEvent]) in events = rows },
                                      fetch: { try await api.events(bubbleID: bubbleID) })
        if ok { await reactions.load(api: api, bubbleID: bubbleID, targetIDs: events.map(\.id)) }
    }

    /// Other members' inserts, edits and deletes stream in until the view goes away (docs/boolaa-spec.md, Realtime tables).
    func listen(api: BoolaaAPI, bubbleID: UUID) async {
        await LiveFeed.observe(BubbleEvent.self, api: api, bubbleID: bubbleID,
                               rows: { [weak self] in self?.events ?? [] },
                               apply: { [weak self] in self?.events = $0 },
                               reload: { [weak self] in await self?.load(api: api, bubbleID: bubbleID) },
                               reactions: reactions)
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

/// Past events (docs/boolaa-spec.md "Events"): events store only their start and last 1 hour (like "Add to
/// calendar"), so an event has ended once start + 1 h has passed. The server (`toggle_rsvp`), web and Android
/// use the same rule. Unit-tested.
enum EventSchedule {
    static let duration: TimeInterval = CalendarEventFields.defaultDuration

    static func hasEnded(_ event: BubbleEvent, now: Date) -> Bool {
        event.datetime.addingTimeInterval(duration) <= now
    }

    /// Upcoming events (soonest first) and past ones (most recent first).
    static func split(_ events: [BubbleEvent], now: Date) -> (upcoming: [BubbleEvent], past: [BubbleEvent]) {
        let sorted = events.sorted { $0.datetime < $1.datetime }
        return (sorted.filter { !hasEnded($0, now: now) }, sorted.filter { hasEnded($0, now: now) }.reversed())
    }
}

/// "My events" and "Bubble events" (upcoming, sorted by date, with RSVP), then a collapsed "Past events"
/// section without RSVP (spec §7).
struct EventsView: View {
    @Environment(SessionStore.self) private var session
    @Environment(Connectivity.self) private var connectivity
    @State private var model = EventsModel()
    @State private var editing: EventEditorTarget?
    @State private var exporting: BubbleEvent?
    @State private var showPast = DebugHooks.expandPastEvents
    /// Ticks every 30 s so events move to "Past" while the screen is open.
    @State private var now = Date.now

    private var sections: (upcoming: [BubbleEvent], past: [BubbleEvent]) { EventSchedule.split(model.events, now: now) }
    private var mine: [BubbleEvent] { sections.upcoming.filter { $0.creatorId == session.userID } }
    private var others: [BubbleEvent] { sections.upcoming.filter { $0.creatorId != session.userID } }
    private var past: [BubbleEvent] { sections.past }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                SectionHeaderWithAction(title: "My events", count: mine.count, hue: hue) {
                    AddButton(label: "New event", id: "new-event", hue: hue) { editing = .new }
                }
                LoadIssueView(failed: model.failed, hasContent: model.loaded) { await reload() }
                if !model.loaded && !model.failed { Delayed { SkeletonList(count: 2) } }
                if model.loaded && model.events.isEmpty {
                    // Nothing at all in this bubble: one empty state (§8.4), no "Bubble events" section.
                    EmptyStateView(title: LocalizedStringResource("Quiet week…", comment: "Events empty state title"),
                                   message: LocalizedStringResource("Plan the next thing and your bubble can join in.", comment: "Events empty state hint (no events at all)"),
                                   hue: MascotPlace.events.hue(bubble: hue))
                } else if model.loaded && mine.isEmpty {
                    EmptyStateView(title: LocalizedStringResource("Got a plan?", comment: "Events, empty “My events” title"),
                                   message: LocalizedStringResource("Dinner, a hike, a film night: start something.", comment: "Events, empty “My events” hint"),
                                   hue: MascotPlace.events.hue(bubble: hue))
                }
                ForEach(Array(mine.enumerated()), id: \.element.id) { index, event in
                    EventCard(event: event, myID: session.userID,
                              onRSVP: { Task { await model.toggleRSVP(api: session.api, event: event) } },
                              onAddToCalendar: { addToCalendar(event) },
                              reactions: model.reactions.summary(for: event.id, me: session.userID),
                              onReact: { react(event, $0) },
                              onEdit: { editing = .edit(event) },
                              onDelete: { Task { await model.delete(api: session.api, event: event) } })
                        .safetyContextMenu(.event(event), react: { react(event, $0) })
                        .popIn(index)
                        .pushHighlightTarget(event.id)
                }

                if !(model.loaded && model.events.isEmpty) {
                    SectionHeader(title: "Bubble events", count: others.count, hue: hue)
                }
                if model.loaded && others.isEmpty && !model.events.isEmpty {
                    EmptyStateView(title: LocalizedStringResource("Quiet week…", comment: "Events empty state title"),
                                   message: LocalizedStringResource("Nobody else has planned anything yet.", comment: "Events, empty “Bubble events” hint"),
                                   hue: MascotPlace.events.hue(bubble: hue))
                }
                ForEach(Array(others.enumerated()), id: \.element.id) { index, event in
                    EventCard(event: event, myID: session.userID,
                              onRSVP: { Task { await model.toggleRSVP(api: session.api, event: event) } },
                              onAddToCalendar: { addToCalendar(event) },
                              reactions: model.reactions.summary(for: event.id, me: session.userID),
                              onReact: { react(event, $0) })
                        .safetyContextMenu(.event(event), react: { react(event, $0) })
                        .popIn(index + mine.count)
                        .pushHighlightTarget(event.id)
                }

                if !past.isEmpty { pastSection }
            }
            .padding(.horizontal, 16)
            .padding(.top, 4)
            .padding(.bottom, Theme.tabBarClearance)
            .animation(Motion.gentle, value: model.events.map(\.id))
        }
        .scrollsToPushHighlight(model.events.map(\.id))
        .refreshFeedback { await reload() }
        // Back online or in the foreground: reload and resubscribe (Connectivity.refreshGeneration).
        .task(id: connectivity.refreshGeneration) {
            await reload()
            if let id = session.currentBubble?.id { await model.listen(api: session.api, bubbleID: id) }
        }
        .autoRetry(failed: model.failed) { await reload() }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                now = .now
            }
        }
        .sheet(item: $editing) { target in
            EventEditor(target: target) {
                // "First" = none upcoming of yours in this bubble before the save (§8.4).
                if case .new = target, mine.isEmpty { CheerCenter.shared.show(CheerCenter.firstEvent, hue: .coral) }
                Task { await reload() }
            }.boolaaSheet()
        }
        .sheet(item: $exporting) { event in
            AddToCalendarSheet(fields: CalendarEventFields(event)) { exporting = nil }.ignoresSafeArea()
        }
        .errorAlert($model.error)
    }

    private var hue: Hue { Feature.events.hue }

    /// Past events: a header that expands the list (collapsed by default), cards without RSVP.
    @ViewBuilder private var pastSection: some View {
        Button {
            withAnimation(Motion.gentle) { showPast.toggle() }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "calendar.badge.checkmark")
                Text("Past events", comment: "Section with events that already ended")
                    .font(.rounded(.headline))
                Text(verbatim: "\(past.count)")
                    .font(.rounded(.caption, weight: .bold)).monospacedDigit()
                    .padding(.horizontal, 8).padding(.vertical, 2)
                    .background(Theme.field, in: Capsule())
                Spacer()
                Image(systemName: "chevron.down")
                    .rotationEffect(.degrees(showPast ? 180 : 0))
            }
            .foregroundStyle(Theme.inkSecondary)
            .padding(.top, 18).padding(.bottom, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isHeader)
        .accessibilityValue(showPast ? Text("Expanded") : Text("Collapsed"))
        .accessibilityIdentifier("past-events")
        if showPast {
            ForEach(past) { event in
                EventCard(event: event, myID: session.userID, ended: true,
                          onRSVP: {},
                          reactions: model.reactions.summary(for: event.id, me: session.userID),
                          onReact: { react(event, $0) },
                          onEdit: event.creatorId == session.userID ? { editing = .edit(event) } : nil,
                          onDelete: event.creatorId == session.userID ? { Task { await model.delete(api: session.api, event: event) } } : nil)
                    .opacity(0.75)
                    .safetyContextMenu(.event(event), react: { react(event, $0) })
                    .pushHighlightTarget(event.id)
                    .transition(.opacity)
            }
        }
    }

    private func react(_ event: BubbleEvent, _ kind: ReactionKind) {
        Task {
            if let e = await model.reactions.toggle(api: session.api, target: event.id, kind: kind, me: session.userID) { model.error = e }
        }
    }

    private func addToCalendar(_ event: BubbleEvent) {
        if BubbleEvent.calendarExportBlocked {
            model.error = String(localized: "Allow calendar access in Settings to add events.",
                                 comment: "Error when calendar access is restricted")
        } else {
            exporting = event
        }
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
    /// A past event: no RSVP (toggle_rsvp refuses it), "Ended" instead and "N went".
    var ended = false
    var onRSVP: () -> Void
    var onAddToCalendar: (() -> Void)? = nil
    var reactions: [ReactionSummary] = []
    var onReact: ((ReactionKind) -> Void)? = nil
    var onEdit: (() -> Void)? = nil
    var onDelete: (() -> Void)? = nil
    @State private var confirmDelete = false
    @State private var taps = 0
    @State private var bursts = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var typeSize

    private var going: Bool { myID.map(event.rsvpList.contains) ?? false }
    @ScaledMetric(relativeTo: .title2) private var tileWidth: CGFloat = 56
    @ScaledMetric(relativeTo: .title2) private var tileHeight: CGFloat = 64

    @ViewBuilder private var creatorLabel: some View {
        if let creator = event.creator {
            AvatarView(user: creator, size: 24).accessibilityHidden(true)
            Text(verbatim: creator.displayName).font(.caption.weight(.medium)).foregroundStyle(Theme.inkSecondary).lineLimit(1)
        }
    }

    @ViewBuilder private var goingCount: some View {
        if ended {
            Text("\(event.rsvpList.count) went", comment: "Number of people who went to an event that ended")
                .font(.rounded(.caption, weight: .semibold)).monospacedDigit()
                .foregroundStyle(Theme.inkSecondary).lineLimit(1)
        } else {
            liveGoingCount
        }
    }

    private var liveGoingCount: some View {
        Text("\(event.rsvpList.count) going", comment: "Number of people who RSVPed to an event")
            .font(.rounded(.caption, weight: .semibold)).monospacedDigit()
            .foregroundStyle(Theme.inkSecondary).lineLimit(1)
            .contentTransition(.numericText(value: Double(event.rsvpList.count)))
    }

    @ViewBuilder private var rsvpButton: some View {
        if ended { endedChip } else { liveRSVPButton }
    }

    private var endedChip: some View {
        HStack(spacing: 6) {
            Image(systemName: going ? "checkmark.circle.fill" : "clock.fill")
            Text("Ended", comment: "Shown instead of the RSVP button on an event that already ended").lineLimit(1)
        }
        .font(.rounded(.subheadline))
        .foregroundStyle(Theme.inkSecondary)
        .padding(.horizontal, 14).frame(minHeight: 44)
        .background(Capsule().fill(Theme.field))
        .fixedSize()
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("rsvp-ended-\(event.title)")
    }

    private var liveRSVPButton: some View {
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
            .padding(.horizontal, 14).frame(minHeight: 44)
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
                // Calendar-page tile, tipped a little like a sticker. Left out at the accessibility text sizes:
                // the date is in the clock line below, and the text gets the full width.
                if !typeSize.isAccessibilitySize {
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
                }

                VStack(alignment: .leading, spacing: 5) {
                    HStack(alignment: .top) {
                        Text(verbatim: event.title).font(.rounded(.headline))
                            .accessibilityAddTraits(.isHeader)
                        Spacer()
                        if let onAddToCalendar {
                            Button(action: onAddToCalendar) {
                                Image(systemName: "calendar.badge.plus").font(.body.weight(.semibold))
                                    .foregroundStyle(Feature.events.hue.text).frame(width: 44, height: 44).contentShape(Rectangle()).dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                            }
                            .buttonStyle(.squish)
                            .accessibilityLabel(Text("Add to calendar", comment: "Button adding an event to the phone's calendar"))
                            .accessibilityIdentifier("add-to-calendar-\(event.title)")
                        }
                        if onEdit != nil {
                            Menu {
                                Button("Edit", systemImage: "pencil") { onEdit?() }
                                Button("Delete", systemImage: "trash", role: .destructive) { confirmDelete = true }
                            } label: {
                                Image(systemName: "ellipsis").font(.body.weight(.bold)).foregroundStyle(Theme.inkSecondary).frame(width: 44, height: 44).contentShape(Rectangle()).dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                            }
                            .accessibilityLabel(Text("More actions"))
                            .accessibilityIdentifier("event-menu")
                        }
                    }
                    Label(event.datetime.formatted(date: .abbreviated, time: .shortened), systemImage: "clock.fill")
                        .font(.subheadline).foregroundStyle(Theme.inkSecondary)
                    if let location = event.location?.nilIfEmpty {
                        Label { Text(verbatim: location) } icon: { Image(systemName: "mappin.circle.fill") }.font(.subheadline).foregroundStyle(Theme.inkSecondary)
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
            if let onReact {
                ReactionBar(summaries: reactions, hue: hue, onToggle: onReact)
            }
        }
        .card()
        .animation(Motion.resolve(Motion.bouncy, reduceMotion: reduceMotion), value: going)
        .animation(Motion.snappy, value: event.rsvpList.count)
        .onChange(of: going) { _, now in
            // The server confirmed your RSVP: confetti and the cheer toast (which plays the success haptic).
            if now && taps > 0 {
                bursts += 1
                CheerCenter.shared.show(CheerCenter.going, hue: .mint)
            }
        }
        .haptic(.rsvpTap, trigger: taps)
        .confirmationDialog(Text("Delete “\(event.title)”?", comment: "Confirmation title; the argument is the event title"), isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { Interaction.destructiveConfirm.play(); onDelete?() }
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
                        .fieldShell()
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
