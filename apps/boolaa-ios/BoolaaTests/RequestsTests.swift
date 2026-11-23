import Foundation
import Supabase
import Testing
@testable import Boolaa

/// "I want it" requests and food expiry (docs/boolaa-spec.md, "Requests and picking", "Food expiry"): the pure rules.
private let item = UUID()
private let owner = UUID()
private let me = UUID()
private let ana = UUID()

private func request(_ requester: UUID, _ status: ItemRequestStatus, at seconds: TimeInterval = 0, item: UUID = item) -> ItemRequest {
    ItemRequest(id: UUID(), bubbleId: UUID(), ownerId: owner, requesterId: requester, itemKind: .market, itemId: item,
                note: nil, status: status, createdAt: Date(timeIntervalSince1970: seconds), statusChangedAt: nil)
}

private func lproj(_ lang: String) throws -> Bundle {
    let path = try #require(Bundle.main.path(forResource: lang, ofType: "lproj"))
    return try #require(Bundle(path: path))
}

@Suite("Requests: what the action row shows")
struct RequestActionTests {
    @Test func noRequestOfMine() {
        #expect(RequestAction.resolve(availability: .available, mine: nil) == .iWantIt)
        #expect(RequestAction.resolve(availability: .reserved, mine: nil) == RequestAction.none)
        #expect(RequestAction.resolve(availability: .taken, mine: nil) == RequestAction.none)
    }

    @Test func myRequest() {
        #expect(RequestAction.resolve(availability: .available, mine: request(me, .pending)) == .requested(onList: false))
        #expect(RequestAction.resolve(availability: .reserved, mine: request(me, .pending)) == .requested(onList: true))
        #expect(RequestAction.resolve(availability: .reserved, mine: request(me, .picked)) == .reservedForYou)
        #expect(RequestAction.resolve(availability: .taken, mine: request(me, .received)) == .yours)
        #expect(RequestAction.resolve(availability: .taken, mine: request(me, .missed)) == .missed)
    }
}

@Suite("Requests: merge and state rules")
struct RequestSetTests {
    @Test func oldestFirstWithThePickOnTop() {
        let a = request(ana, .pending, at: 10), b = request(me, .pending, at: 20), c = request(UUID(), .picked, at: 30)
        let set = RequestSet([b, c, a, request(UUID(), .pending, item: UUID())])
        #expect(set.requests(for: item).map(\.id) == [c.id, a.id, b.id])
        #expect(set.picked(for: item)?.id == c.id)
        #expect(set.mine(for: item, me: me)?.id == b.id)
        #expect(set.mine(for: item, me: nil) == nil)
    }

    @Test func pickMovesThePreviousPickBackToPending() {
        let a = request(ana, .picked, at: 1), b = request(me, .pending, at: 2)
        var set = RequestSet([a, b])
        var picked = b
        picked.status = .picked
        set.applyPick(picked)
        #expect(set.byID[a.id]?.status == .pending)
        #expect(set.byID[b.id]?.status == .picked)
    }

    @Test func handOverUnpickAndReserveMirrorTheDatabase() {
        let a = request(ana, .picked, at: 1), b = request(me, .pending, at: 2)
        var set = RequestSet([a, b])
        set.applyHandOver(item: item)
        #expect(set.byID[a.id]?.status == .received && set.byID[b.id]?.status == .missed)
        set.applyReserve(item: item) // market "Mark as reserved" restores the winner, invents nothing
        #expect(set.byID[a.id]?.status == .picked && set.byID[b.id]?.status == .pending)
        set.applyUnpick(item: item)
        #expect(set.byID.values.allSatisfy { $0.status == .pending })
        #expect(set.open(for: item).count == 2)
    }

    @Test func liveRowsKeepTheirRequesterAndDeletesByID() {
        var withName = request(ana, .pending)
        withName.requester = UserProfile(id: ana, name: "Ana", avatar: nil, createdAt: nil)
        var set = RequestSet([withName])
        var update = withName
        update.requester = nil
        update.status = .picked
        set.upsert(update) // an UPDATE payload has no join
        #expect(set.byID[withName.id]?.requester?.name == "Ana")
        #expect(set.byID[withName.id]?.status == .picked)
        set.remove(id: UUID()) // someone else's delete
        #expect(set.byID.count == 1)
        set.remove(id: withName.id)
        #expect(set.byID.isEmpty)
    }

    @Test func decodesARowWithItsGeneratedColumns() throws {
        let json = """
        {"id":"\(UUID().uuidString)","bubble_id":"\(UUID().uuidString)","owner_id":"\(owner.uuidString)",
         "requester_id":"\(ana.uuidString)","item_kind":"food","item_id":"\(item.uuidString)",
         "food_post_id":"\(item.uuidString)","market_item_id":null,"note":"Tonight?","status":"picked",
         "created_at":"2026-11-24T10:00:00+00:00","status_changed_at":"2026-11-24T10:05:00.123+00:00",
         "requester":{"id":"\(ana.uuidString)","name":"Ana","avatar":null}}
        """
        let r = try BoolaaJSON.decoder.decode(ItemRequest.self, from: Data(json.utf8))
        #expect(r.itemKind == .food && r.itemId == item && r.status == .picked && r.note == "Tonight?")
        #expect(r.requester?.name == "Ana")
    }
}

@Suite("Requests: errors and push")
struct RequestErrorAndPushTests {
    @Test(arguments: [
        ("item not found", UserFacingError.itemGone),
        ("item not available", .itemNotAvailable),
        ("already requested", .alreadyRequested),
        ("cannot request own item", .cannotRequestOwn),
        ("request note too long", .requestNoteTooLong),
        ("item request gone", .requestGone),
        ("request already decided", .requestDecided),
        ("nothing picked", .nothingPicked),
        ("invalid expiry", .invalidExpiry),
        ("not your item", .generic),
        ("invalid item kind", .generic),
        // Older texts still map as before.
        ("request not found", .requestNotFound),
    ])
    func backendTexts(message: String, expected: UserFacingError) {
        #expect(UserFacingError.classify(PostgrestError(message: message)) == expected)
    }

    @Test func staleListErrorsReload() {
        #expect(UserFacingError.itemGone.reloadsItems && UserFacingError.itemNotAvailable.reloadsItems && UserFacingError.requestGone.reloadsItems)
        #expect(!UserFacingError.alreadyRequested.reloadsItems)
    }

    @Test(arguments: [
        ("item_request", "food", PushDestination.food, true),
        ("item_request_withdrawn", "market", .marketplace, true),
        ("item_picked", "food", .food, false),
        ("item_missed", "market", .marketplace, false),
    ])
    func requestPushesOpenTheItem(type: String, kind: String, destination: PushDestination, opensSheet: Bool) throws {
        let bubble = UUID(), target = UUID()
        let payload = try #require(PushPayload(userInfo: ["type": type, "bubble_id": bubble.uuidString,
                                                          "target_id": target.uuidString, "item_kind": kind]))
        #expect(payload.itemKind == ItemKind(rawValue: kind))
        let resolved = PushRoute(payload: payload).resolve(joined: [bubble])
        #expect(resolved.destination == destination)
        #expect(resolved.highlight == target)
        #expect(resolved.openRequests == (opensSheet ? target : nil))
    }

    @Test func aRequestPushWithoutKindOpensHome() throws {
        let bubble = UUID()
        let payload = try #require(PushPayload(userInfo: ["type": "item_picked", "bubble_id": bubble.uuidString,
                                                          "target_id": UUID().uuidString]))
        let resolved = PushRoute(payload: payload).resolve(joined: [bubble])
        #expect(resolved.destination == .home && resolved.highlight == nil && resolved.openRequests == nil)
    }

    @Test(arguments: [("en", "3 requests", "1 request"), ("ro", "3 cereri", "1 cerere"), ("fr", "3 demandes", "1 demande"),
                      ("es", "3 solicitudes", "1 solicitud"), ("it", "3 richieste", "1 richiesta")])
    func countPlurals(lang: String, three: String, one: String) throws {
        let bundle = try lproj(lang), locale = Locale(identifier: lang)
        #expect(String(localized: "\(3) requests", bundle: bundle, locale: locale) == three)
        #expect(String(localized: "\(1) requests", bundle: bundle, locale: locale) == one)
        if lang == "ro" { #expect(String(localized: "\(20) requests", bundle: bundle, locale: locale) == "20 de cereri") }
    }
}

@Suite("Food expiry")
struct FoodExpiryTests {
    private var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Europe/Bucharest")!
        return c
    }

    private func at(_ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
        calendar.date(from: DateComponents(year: 2026, month: 11, day: day, hour: hour, minute: minute))!
    }

    @Test func presetsAreLocal2359() {
        let now = at(24, 10) // Tuesday
        #expect(FoodExpiry.value(.today, now: now, calendar: calendar) == at(24, 23, 59))
        #expect(FoodExpiry.value(.tomorrow, now: now, calendar: calendar) == at(25, 23, 59))
        #expect(FoodExpiry.value(.in3Days, now: now, calendar: calendar) == at(27, 23, 59))
        #expect(FoodExpiry.value(.custom, now: now, calendar: calendar) == nil)
        #expect(FoodExpiry.defaultCustom(now: now, calendar: calendar) == at(25, 18))
    }

    @Test func todayIsDisabledFrom23() {
        #expect(FoodExpiry.todayAvailable(now: at(24, 22, 59), calendar: calendar))
        #expect(!FoodExpiry.todayAvailable(now: at(24, 23, 0), calendar: calendar))
    }

    @Test func customRange() {
        let now = at(24, 10)
        let range = FoodExpiry.customRange(now: now)
        #expect(range.lowerBound == now.addingTimeInterval(15 * 60))
        #expect(range.upperBound == now.addingTimeInterval(14 * 86400 - 5 * 60))
    }

    @Test func editingPreselectsToTheMinute() {
        let now = at(24, 10)
        #expect(FoodExpiry.preselect(at(25, 23, 59).addingTimeInterval(20), now: now, calendar: calendar) == .tomorrow)
        #expect(FoodExpiry.preselect(at(24, 23, 59), now: now, calendar: calendar) == .today)
        #expect(FoodExpiry.preselect(at(27, 23, 59), now: now, calendar: calendar) == .in3Days)
        #expect(FoodExpiry.preselect(at(26, 18), now: now, calendar: calendar) == .custom)
    }

    @Test func cardLabel() {
        let now = at(24, 10) // Tuesday 24 Nov
        #expect(FoodExpiry.label(expiresAt: now.addingTimeInterval(20), now: now, calendar: calendar) == .minutes(1))
        #expect(FoodExpiry.label(expiresAt: now.addingTimeInterval(59 * 60 + 30), now: now, calendar: calendar) == .minutes(59))
        #expect(FoodExpiry.label(expiresAt: now.addingTimeInterval(5 * 3600 + 3500), now: now, calendar: calendar) == .hours(5))
        #expect(FoodExpiry.label(expiresAt: at(24, 18), now: now, calendar: calendar) == .today(at(24, 18)))
        #expect(FoodExpiry.label(expiresAt: at(25, 18), now: now, calendar: calendar) == .tomorrow(at(25, 18)))
        #expect(FoodExpiry.label(expiresAt: at(27, 18), now: now, calendar: calendar) == .weekday(at(27, 18)))
        #expect(FoodExpiry.label(expiresAt: at(30, 18), now: now, calendar: calendar) == .weekday(at(30, 18)))
        #expect(FoodExpiry.label(expiresAt: at(1, 18).addingTimeInterval(30 * 86400), now: now, calendar: calendar)
                == .date(at(1, 18).addingTimeInterval(30 * 86400))) // 1 Dec, 7 days ahead
        #expect(FoodExpiry.Label.minutes(5).isUrgent && !FoodExpiry.Label.hours(2).isUrgent)
    }

    @Test(arguments: [
        ("en", "Expires in 1 minute", "Expires in 5 minutes", "Expires in 2 hours"),
        ("ro", "Expiră într-un minut", "Expiră în 5 minute", "Expiră în 2 ore"),
        ("fr", "Expire dans 1 minute", "Expire dans 5 minutes", "Expire dans 2 heures"),
        ("es", "Caduca en 1 minuto", "Caduca en 5 minutos", "Caduca en 2 horas"),
        ("it", "Scade tra 1 minuto", "Scade tra 5 minuti", "Scade tra 2 ore"),
    ])
    func labelTexts(lang: String, oneMinute: String, fiveMinutes: String, twoHours: String) throws {
        let bundle = try lproj(lang), locale = Locale(identifier: lang)
        #expect(FoodExpiry.Label.minutes(1).text(locale: locale, bundle: bundle) == oneMinute)
        #expect(FoodExpiry.Label.minutes(5).text(locale: locale, bundle: bundle) == fiveMinutes)
        #expect(FoodExpiry.Label.hours(2).text(locale: locale, bundle: bundle) == twoHours)
        if lang == "ro" {
            #expect(FoodExpiry.Label.minutes(20).text(locale: locale, bundle: bundle) == "Expiră în 20 de minute")
            #expect(FoodExpiry.Label.hours(1).text(locale: locale, bundle: bundle) == "Expiră într-o oră")
        }
        let today = FoodExpiry.Label.today(Date()).text(locale: locale, bundle: bundle)
        #expect(!today.contains("%"))
    }

    @Test func expiredAndHandedOverPostsAreHidden() {
        let now = Date()
        func post(_ expires: Date?, _ availability: MarketAvailability = .available) -> FoodPost {
            FoodPost(id: UUID(), bubbleId: UUID(), userId: me, image: "", description: nil, createdAt: now,
                     expiresAt: expires, availability: availability)
        }
        let posts = [post(now.addingTimeInterval(60)), post(now), post(now.addingTimeInterval(-1)),
                     post(now.addingTimeInterval(3600), .taken), post(now.addingTimeInterval(3600), .reserved), post(nil)]
        #expect(FoodModel.visible(posts, at: now).count == 3)
        #expect(FoodExpiry.nextExpiry(of: posts, after: now) == now.addingTimeInterval(60))
    }

    @Test func expiryIsSentAsAUTCInstant() throws {
        let input = FoodInput(image: "x", description: nil, expiresAt: Date(timeIntervalSince1970: 1_800_000_000))
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(input)) as? [String: Any]
        #expect(json?["expires_at"] as? String == "2027-01-15T08:00:00Z")
        let edit = try JSONSerialization.jsonObject(with: JSONEncoder().encode(FoodInput(image: "x", description: nil))) as? [String: Any]
        #expect(edit?["expires_at"] == nil)
    }

    @Test func oldCachedPostsStillDecode() throws {
        let json = """
        {"id":"\(UUID().uuidString)","bubble_id":"\(UUID().uuidString)","user_id":"\(me.uuidString)","image":"x",
         "description":null,"created_at":"2026-11-24T10:00:00+00:00"}
        """
        let post = try BoolaaJSON.decoder.decode(FoodPost.self, from: Data(json.utf8))
        #expect(post.expiresAt == nil && post.availability == .available && post.requestCount == 0)
        #expect(post.isVisible(at: .now))
    }
}
