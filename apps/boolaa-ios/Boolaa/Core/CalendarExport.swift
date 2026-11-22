import EventKit
import EventKitUI
import SwiftUI

/// What "Add to calendar" puts in the system editor (docs/boolaa-spec.md, "Add to calendar").
/// Events store only their start (`datetime`), so the end is one hour later, like the web .ics
/// and Android export.
struct CalendarEventFields: Equatable, Sendable {
    static let defaultDuration: TimeInterval = 60 * 60

    var title: String
    var start: Date
    var end: Date
    var location: String?
    var notes: String?

    init(_ event: BubbleEvent) {
        title = event.title
        start = event.datetime
        end = event.datetime.addingTimeInterval(Self.defaultDuration)
        location = event.location?.nilIfEmpty
        notes = event.description?.nilIfEmpty
    }

    func apply(to ek: EKEvent) {
        ek.title = title
        ek.startDate = start
        ek.endDate = end
        ek.isAllDay = false
        ek.timeZone = nil // a fixed instant; the calendar shows it in the viewer's zone
        ek.location = location
        ek.notes = notes
    }
}

extension BubbleEvent {
    /// Calendar access restricted by Screen Time / MDM: the system editor can't save, so say so instead.
    static var calendarExportBlocked: Bool { EKEventStore.authorizationStatus(for: .event) == .restricted }
}

/// `EKEventEditViewController` prefilled with the event: the user confirms (or edits, or cancels)
/// in the system UI. On iOS 17+ this needs no calendar permission prompt.
struct AddToCalendarSheet: UIViewControllerRepresentable {
    var fields: CalendarEventFields
    var onDone: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onDone: onDone) }

    func makeUIViewController(context: Context) -> EKEventEditViewController {
        let store = EKEventStore()
        let event = EKEvent(eventStore: store)
        fields.apply(to: event)
        event.calendar = store.defaultCalendarForNewEvents
        let controller = EKEventEditViewController()
        controller.eventStore = store
        controller.event = event
        controller.editViewDelegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: EKEventEditViewController, context: Context) {}

    @MainActor
    final class Coordinator: NSObject, @preconcurrency EKEventEditViewDelegate {
        let onDone: () -> Void
        init(onDone: @escaping () -> Void) { self.onDone = onDone }

        func eventEditViewController(_ controller: EKEventEditViewController, didCompleteWith action: EKEventEditViewAction) {
            onDone()
        }
    }
}
