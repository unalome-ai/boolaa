import Foundation

/// "Good until" for food posts (docs/boolaa-spec.md, "Food expiry"). Pure rules, unit-tested; times are local.
enum FoodExpiry {
    enum Preset: String, CaseIterable, Identifiable, Sendable {
        case today, tomorrow, in3Days, custom
        var id: String { rawValue }
        var label: LocalizedStringResource {
            switch self {
            case .today: LocalizedStringResource("Today", comment: "Food expiry preset")
            case .tomorrow: LocalizedStringResource("Tomorrow", comment: "Food expiry preset")
            case .in3Days: LocalizedStringResource("In 3 days", comment: "Food expiry preset")
            case .custom: LocalizedStringResource("Custom", comment: "Food expiry preset: pick a date and time")
            }
        }
        /// Days after today whose 23:59 the preset means.
        var dayOffset: Int? {
            switch self {
            case .today: 0
            case .tomorrow: 1
            case .in3Days: 3
            case .custom: nil
            }
        }
    }

    /// The server accepts at most 14 days ahead; the picker keeps 5 minutes of margin for clock skew.
    static let maxAhead: TimeInterval = 14 * 24 * 3600
    static let minAhead: TimeInterval = 15 * 60

    /// 23:59 of the preset's day (nil for Custom).
    static func value(_ preset: Preset, now: Date, calendar: Calendar = .current) -> Date? {
        guard let offset = preset.dayOffset,
              let day = calendar.date(byAdding: .day, value: offset, to: calendar.startOfDay(for: now)) else { return nil }
        return calendar.date(bySettingHour: 23, minute: 59, second: 0, of: day)
    }

    /// "Today" is disabled from 23:00 (less than an hour left).
    static func todayAvailable(now: Date, calendar: Calendar = .current) -> Bool {
        calendar.component(.hour, from: now) < 23
    }

    /// The Custom picker's range: now + 15 min … now + 14 days − 5 min.
    static func customRange(now: Date) -> ClosedRange<Date> {
        now.addingTimeInterval(minAhead)...now.addingTimeInterval(maxAhead - 5 * 60)
    }

    /// Custom starts at tomorrow 18:00.
    static func defaultCustom(now: Date, calendar: Calendar = .current) -> Date {
        let tomorrow = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now)) ?? now
        return calendar.date(bySettingHour: 18, minute: 0, second: 0, of: tomorrow) ?? tomorrow
    }

    /// Editing preselects the segment whose value equals `expiresAt` to the minute, else Custom with it.
    static func preselect(_ expiresAt: Date, now: Date, calendar: Calendar = .current) -> Preset {
        let minute = { (d: Date) in Int(d.timeIntervalSinceReferenceDate / 60) }
        for preset in [Preset.today, .tomorrow, .in3Days] {
            if let v = value(preset, now: now, calendar: calendar), minute(v) == minute(expiresAt) { return preset }
        }
        return .custom
    }

    /// The card's label (glossary `food.expiresIn*` / `food.goodUntil*`).
    enum Label: Equatable, Sendable {
        case minutes(Int)
        case hours(Int)
        case today(Date)
        case tomorrow(Date)
        case weekday(Date)
        case date(Date)

        /// Under one hour the label uses the warning text colour.
        var isUrgent: Bool { if case .minutes = self { true } else { false } }

        func text(locale: Locale = .current, bundle: Bundle = .main) -> String {
            let time = { (d: Date) in d.formatted(Date.FormatStyle(date: .omitted, time: .shortened).locale(locale)) }
            switch self {
            case .minutes(let n):
                return String(localized: "Expires in \(n) minutes", bundle: bundle, locale: locale, comment: "Food card: less than an hour left")
            case .hours(let n):
                return String(localized: "Expires in \(n) hours", bundle: bundle, locale: locale, comment: "Food card: less than 6 hours left")
            case .today(let d):
                return String(localized: "Good until today \(time(d))", bundle: bundle, locale: locale, comment: "Food card expiry; the argument is a time of day")
            case .tomorrow(let d):
                return String(localized: "Good until tomorrow \(time(d))", bundle: bundle, locale: locale, comment: "Food card expiry; the argument is a time of day")
            case .weekday(let d):
                let day = d.formatted(Date.FormatStyle().weekday(.wide).locale(locale))
                return String(localized: "Good until \(day) \(time(d))", bundle: bundle, locale: locale, comment: "Food card expiry; arguments: weekday name, time of day")
            case .date(let d):
                let date = d.formatted(Date.FormatStyle().day().month(.abbreviated).locale(locale))
                return String(localized: "Good until \(date), \(time(d))", bundle: bundle, locale: locale, comment: "Food card expiry; arguments: short date, time of day")
            }
        }
    }

    static func label(expiresAt: Date, now: Date, calendar: Calendar = .current) -> Label {
        let left = expiresAt.timeIntervalSince(now)
        if left < 3600 { return .minutes(max(1, Int(left / 60))) }
        if left < 6 * 3600 { return .hours(Int(left / 3600)) }
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: expiresAt)).day ?? 0
        switch days {
        case ...0: return .today(expiresAt)
        case 1: return .tomorrow(expiresAt)
        case 2..<7: return .weekday(expiresAt)
        default: return .date(expiresAt)
        }
    }

    /// The next moment the visible list changes on its own: the earliest expiry still ahead.
    static func nextExpiry(of posts: [FoodPost], after now: Date) -> Date? {
        posts.compactMap(\.expiresAt).filter { $0 > now }.min()
    }
}
