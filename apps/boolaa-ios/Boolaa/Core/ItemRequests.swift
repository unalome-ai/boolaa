import Foundation
import Supabase

/// "I want it" requests on food posts and marketplace items, the owner's pick and the hand-over
/// (docs/boolaa-spec.md, "Requests and picking"; migration 20261124100000_requests_food_expiry.sql).

enum ItemKind: String, Codable, Sendable {
    case food, market
}

enum ItemRequestStatus: String, Codable, Sendable {
    case pending, picked, received, missed
    /// Unknown future values read as pending rather than failing the whole list.
    init(from decoder: any Decoder) throws {
        self = ItemRequestStatus(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .pending
    }
}

/// `public.item_requests`. RLS returns the caller's own rows plus the rows on the caller's items.
struct ItemRequest: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let bubbleId: UUID
    let ownerId: UUID
    let requesterId: UUID
    let itemKind: ItemKind
    let itemId: UUID
    var note: String?
    var status: ItemRequestStatus
    var createdAt: Date
    var statusChangedAt: Date?
    var requester: UserProfile?

    static let selectColumns = "*, requester:users!requester_id(\(BoolaaAPI.authorColumns))"

    enum CodingKeys: String, CodingKey {
        case id, note, status, requester
        case bubbleId = "bubble_id"
        case ownerId = "owner_id"
        case requesterId = "requester_id"
        case itemKind = "item_kind"
        case itemId = "item_id"
        case createdAt = "created_at"
        case statusChangedAt = "status_changed_at"
    }
}

/// What the item's action row shows to someone who isn't its owner (spec, "UI rules").
enum RequestAction: Equatable, Sendable {
    /// No request of mine, item available: "I want it".
    case iWantIt
    /// No button: no request of mine and the item is reserved or taken.
    case none
    /// My request is pending: "Requested" chip (or "Reserved · you're on the list") + "Withdraw request".
    case requested(onList: Bool)
    /// My request was picked: "Reserved for you" + "Withdraw request" (with a confirmation).
    case reservedForYou
    /// Market item taken and given to me: "It's yours".
    case yours
    /// Market item taken by someone else after I asked: "Someone else got it".
    case missed

    static func resolve(availability: MarketAvailability, mine: ItemRequest?) -> RequestAction {
        if let mine {
            switch mine.status {
            case .pending: return availability == .taken ? .missed : .requested(onList: availability == .reserved)
            case .picked: return .reservedForYou
            case .received: return .yours
            case .missed: return .missed
            }
        }
        return availability == .available ? .iWantIt : .none
    }
}

/// The requests a screen holds, by item. Pure, so the merge rules are unit-tested.
struct RequestSet: Hashable, Sendable {
    private(set) var byID: [UUID: ItemRequest] = [:]

    init(_ rows: [ItemRequest] = []) { for r in rows { byID[r.id] = r } }

    /// Oldest first (first come, first served), the pick pinned on top.
    func requests(for item: UUID) -> [ItemRequest] {
        byID.values.filter { $0.itemId == item }.sorted { a, b in
            let ap = a.status == .picked || a.status == .received, bp = b.status == .picked || b.status == .received
            if ap != bp { return ap }
            return a.createdAt != b.createdAt ? a.createdAt < b.createdAt : a.id.uuidString < b.id.uuidString
        }
    }

    /// Open requests only (what the owner can still act on): pending and picked.
    func open(for item: UUID) -> [ItemRequest] {
        requests(for: item).filter { $0.status == .pending || $0.status == .picked }
    }

    func mine(for item: UUID, me: UUID?) -> ItemRequest? {
        guard let me else { return nil }
        return byID.values.first { $0.itemId == item && $0.requesterId == me }
    }

    func picked(for item: UUID) -> ItemRequest? {
        byID.values.first { $0.itemId == item && ($0.status == .picked || $0.status == .received) }
    }

    /// Insert or replace by id. A row without its requester join keeps the one already held.
    mutating func upsert(_ row: ItemRequest) {
        var row = row
        if row.requester == nil { row.requester = byID[row.id]?.requester }
        byID[row.id] = row
    }

    /// Ids we don't hold (another bubble's, someone else's) change nothing.
    mutating func remove(id: UUID) { byID[id] = nil }

    /// A fresh load replaces everything for this kind.
    mutating func replace(with rows: [ItemRequest]) { self = RequestSet(rows) }

    /// A pick on the client mirrors `pick_item_request`: r → picked, a previous pick → pending.
    mutating func applyPick(_ r: ItemRequest) {
        for (id, other) in byID where other.itemId == r.itemId && other.status == .picked && id != r.id {
            byID[id]?.status = .pending
        }
        upsert(r)
    }

    /// `unpick_item` / market "Mark as available": every request → pending.
    mutating func applyUnpick(item: UUID) {
        for (id, row) in byID where row.itemId == item { byID[id]?.status = .pending }
    }

    /// `hand_over_item` / market "Mark as taken": picked → received, pending → missed.
    mutating func applyHandOver(item: UUID) {
        for (id, row) in byID where row.itemId == item {
            switch row.status {
            case .picked: byID[id]?.status = .received
            case .pending: byID[id]?.status = .missed
            default: break
            }
        }
    }

    /// Market "Mark as reserved": received → picked, missed → pending (no pick is invented).
    mutating func applyReserve(item: UUID) {
        for (id, row) in byID where row.itemId == item {
            switch row.status {
            case .received: byID[id]?.status = .picked
            case .missed: byID[id]?.status = .pending
            default: break
            }
        }
    }
}

/// One screen's requests (food or market): load, act, and apply live changes.
@MainActor
@Observable
final class RequestStore {
    let kind: ItemKind
    private(set) var set = RequestSet()
    /// Actions in flight per item, so a double tap doesn't send two.
    private(set) var busy: Set<UUID> = []

    init(_ kind: ItemKind) { self.kind = kind }

    func requests(for item: UUID) -> [ItemRequest] { set.requests(for: item) }
    func open(for item: UUID) -> [ItemRequest] { set.open(for: item) }
    func mine(for item: UUID, me: UUID?) -> ItemRequest? { set.mine(for: item, me: me) }
    func picked(for item: UUID) -> ItemRequest? { set.picked(for: item) }
    func isBusy(_ item: UUID) -> Bool { busy.contains(item) }

    func load(api: BoolaaAPI, bubbleID: UUID) async {
        do { set.replace(with: try await api.itemRequests(bubbleID: bubbleID, kind: kind)) } catch {
            // Requests are secondary: the list stays usable without them.
        }
    }

    func reset() { set = RequestSet() }

    /// Runs one RPC for `item`. Returns the classified error (the caller shows it and, for
    /// itemGone / itemNotAvailable / requestGone, reloads the list).
    private func run(_ item: UUID, _ body: () async throws -> Void) async -> UserFacingError? {
        guard busy.insert(item).inserted else { return nil }
        defer { busy.remove(item) }
        do { try await body(); return nil } catch { return UserFacingError.classify(error) }
    }

    /// "I want it". Optimistic: a pending row of mine appears at once and is rolled back on error.
    func request(api: BoolaaAPI, item: UUID, bubbleID: UUID, ownerID: UUID, me: UUID, note: String?) async -> UserFacingError? {
        let placeholder = ItemRequest(id: UUID(), bubbleId: bubbleID, ownerId: ownerID, requesterId: me, itemKind: kind,
                                      itemId: item, note: note, status: .pending, createdAt: .now, statusChangedAt: nil)
        set.upsert(placeholder)
        let error = await run(item) {
            let row = try await api.requestItem(kind: kind, itemID: item, note: note)
            set.remove(id: placeholder.id)
            set.upsert(row)
        }
        if error != nil { set.remove(id: placeholder.id) }
        return error
    }

    /// Withdraw my request; "already gone" (false) counts as success.
    func withdraw(api: BoolaaAPI, _ r: ItemRequest) async -> UserFacingError? {
        set.remove(id: r.id)
        let error = await run(r.itemId) { _ = try await api.withdrawItemRequest(id: r.id) }
        if error != nil { set.upsert(r) }
        return error
    }

    func pick(api: BoolaaAPI, _ r: ItemRequest) async -> UserFacingError? {
        let before = set
        var picked = r
        picked.status = .picked
        set.applyPick(picked)
        let error = await run(r.itemId) { set.applyPick(try await api.pickItemRequest(id: r.id)) }
        if let error {
            set = before
            if error == .requestGone { set.remove(id: r.id) }
        }
        return error
    }

    func unpick(api: BoolaaAPI, item: UUID) async -> UserFacingError? {
        let before = set
        set.applyUnpick(item: item)
        let error = await run(item) { try await api.unpickItem(kind: kind, itemID: item) }
        if error != nil { set = before }
        return error
    }

    func handOver(api: BoolaaAPI, item: UUID) async -> UserFacingError? {
        let before = set
        set.applyHandOver(item: item)
        let error = await run(item) { set.upsert(try await api.handOverItem(kind: kind, itemID: item)) }
        if error != nil { set = before }
        return error
    }

    /// Market "Mark as": the database maps the new availability onto the requests; mirror it locally.
    func applyAvailability(_ availability: MarketAvailability, item: UUID) {
        switch availability {
        case .available: set.applyUnpick(item: item)
        case .reserved: set.applyReserve(item: item)
        case .taken: set.applyHandOver(item: item)
        }
    }

    func liveUpsert(_ r: ItemRequest) { if r.itemKind == kind { set.upsert(r) } }
    func liveDelete(id: UUID) { set.remove(id: id) }

    /// Adds the `item_requests` streams to a screen's channel (call before `subscribe`): INSERT and UPDATE
    /// filtered by bubble (RLS delivers only my rows and rows on my items), DELETE unfiltered (by id).
    /// New ids are fetched once with their requester; UPDATEs replace the row in place.
    func streams(on channel: RealtimeChannelV2, api: BoolaaAPI, bubbleID: UUID) -> @Sendable () async -> Void {
        let filter = RealtimePostgresFilter.eq("bubble_id", value: bubbleID)
        let inserts = channel.postgresChange(InsertAction.self, schema: "public", table: "item_requests", filter: filter)
        let updates = channel.postgresChange(UpdateAction.self, schema: "public", table: "item_requests", filter: filter)
        let deletes = channel.postgresChange(DeleteAction.self, schema: "public", table: "item_requests")
        return { [weak self] in
            await withTaskGroup(of: Void.self) { group in
                group.addTask {
                    for await action in inserts {
                        guard let id = LiveChanges.id(of: action.record),
                              let row = try? await api.itemRequest(id: id) else { continue }
                        await MainActor.run { self?.liveUpsert(row) }
                    }
                }
                group.addTask {
                    for await action in updates {
                        guard let id = LiveChanges.id(of: action.record) else { continue }
                        let held = await MainActor.run { self?.set.byID[id] != nil }
                        if held, let row = try? action.decodeRecord(as: ItemRequest.self, decoder: BoolaaJSON.decoder) {
                            await MainActor.run { self?.liveUpsert(row) }
                        } else if let row = try? await api.itemRequest(id: id) {
                            await MainActor.run { self?.liveUpsert(row) }
                        }
                    }
                }
                group.addTask {
                    for await action in deletes {
                        guard let id = LiveChanges.id(of: action.oldRecord) else { continue }
                        await MainActor.run { self?.liveDelete(id: id) }
                    }
                }
            }
        }
    }
}

extension UserFacingError {
    /// After these the item list is stale: reload it (spec, "Errors → messages").
    var reloadsItems: Bool { self == .itemGone || self == .itemNotAvailable || self == .requestGone }
}

extension BoolaaAPI {
    func itemRequests(bubbleID: UUID, kind: ItemKind) async throws -> [ItemRequest] {
        try await client.from("item_requests")
            .select(ItemRequest.selectColumns)
            .eq("bubble_id", value: bubbleID)
            .eq("item_kind", value: kind.rawValue)
            .execute().value
    }

    func itemRequest(id: UUID) async throws -> ItemRequest? {
        let rows: [ItemRequest] = try await client.from("item_requests")
            .select(ItemRequest.selectColumns)
            .eq("id", value: id)
            .limit(1)
            .execute().value
        return rows.first
    }

    func requestItem(kind: ItemKind, itemID: UUID, note: String?) async throws -> ItemRequest {
        struct Params: Encodable { let p_kind: String; let p_item_id: UUID; let p_note: String? }
        var row: ItemRequest = try await client.rpc("request_item", params: Params(p_kind: kind.rawValue, p_item_id: itemID, p_note: note))
            .execute().value
        if row.requester == nil, let full = try? await itemRequest(id: row.id) { row = full }
        return row
    }

    /// false when the request was already gone (treated as success).
    @discardableResult
    func withdrawItemRequest(id: UUID) async throws -> Bool {
        struct Params: Encodable { let p_request_id: UUID }
        return try await client.rpc("withdraw_item_request", params: Params(p_request_id: id)).execute().value
    }

    func pickItemRequest(id: UUID) async throws -> ItemRequest {
        struct Params: Encodable { let p_request_id: UUID }
        return try await client.rpc("pick_item_request", params: Params(p_request_id: id)).execute().value
    }

    func unpickItem(kind: ItemKind, itemID: UUID) async throws {
        struct Params: Encodable { let p_kind: String; let p_item_id: UUID }
        try await client.rpc("unpick_item", params: Params(p_kind: kind.rawValue, p_item_id: itemID)).execute()
    }

    func handOverItem(kind: ItemKind, itemID: UUID) async throws -> ItemRequest {
        struct Params: Encodable { let p_kind: String; let p_item_id: UUID }
        return try await client.rpc("hand_over_item", params: Params(p_kind: kind.rawValue, p_item_id: itemID)).execute().value
    }
}
