import Foundation
import SwiftUI

/// Private photos (docs/boolaa-spec.md "Images", migration 20261123210000_private_photos.sql).
///
/// Every photo bucket is private. Rows keep the `/storage/v1/object/public/<bucket>/<path>` form of a photo
/// (users.avatar, food_posts.image, market_items.image, bubbles.logo) only as its identifier: the app never
/// loads that URL. `StoredImage` (and RemoteImage, AvatarView, BubbleLogo on top of it) asks this store for a
/// signed URL instead:
///   - batched: every photo asked for within a few milliseconds (a list appearing) is signed with ONE
///     `createSignedURLs` call per bucket;
///   - cached per storage path, not per signed URL: the same signed URL is reused until 5 minutes before it
///     expires (1 hour), so URLCache keeps the bytes and refreshes don't re-download;
///   - refreshed before expiry (StoredImage re-resolves then) and after a load failure (invalidate + retry once).
/// URLs that aren't ours (seed Unsplash photos, already-signed chat URLs) pass through unchanged.
@MainActor
final class PhotoURLs {
    static let shared = PhotoURLs(api: BoolaaAPI(client: Backend.shared))
    static let lifetime = 3600
    static let refreshMargin: TimeInterval = 300
    nonisolated static let buckets: Set<String> = ["avatars", "food.images", "market.images", "bubble.images", "link.previews", "chat.images"]

    struct Ref: Hashable, Sendable {
        let bucket: String
        let path: String
    }

    private let api: BoolaaAPI
    private var entries: [Ref: (url: URL, expires: Date)] = [:]
    private var waiting: [Ref: [CheckedContinuation<URL?, Never>]] = [:]
    private var flushScheduled = false

    init(api: BoolaaAPI) { self.api = api }

    /// The bucket and path behind a stored photo URL (`…/storage/v1/object/public/<bucket>/<path>`), or nil
    /// for anything else (external URLs, signed URLs).
    nonisolated static func ref(fromStored url: String?) -> Ref? {
        guard let url, let range = url.range(of: "/storage/v1/object/public/") else { return nil }
        let rest = url[range.upperBound...].split(separator: "?", maxSplits: 1).first.map(String.init) ?? ""
        guard let slash = rest.firstIndex(of: "/") else { return nil }
        let bucket = String(rest[..<slash])
        let raw = String(rest[rest.index(after: slash)...])
        let path = raw.removingPercentEncoding ?? raw
        guard buckets.contains(bucket), !path.isEmpty, !path.contains("..") else { return nil }
        return Ref(bucket: bucket, path: path)
    }

    /// The cached signed URL and its expiry, while it has more than `refreshMargin` left.
    func cached(_ ref: Ref, now: Date = .now) -> (url: URL, expires: Date)? {
        guard let entry = entries[ref], entry.expires.timeIntervalSince(now) > Self.refreshMargin else { return nil }
        return entry
    }

    /// What to load for a stored photo URL: a signed URL for our private buckets (nil when the caller may not
    /// read it), the URL itself for anything else.
    func resolve(_ stored: String?) async -> URL? {
        guard let stored, !stored.isEmpty else { return nil }
        guard let ref = Self.ref(fromStored: stored) else { return URL(string: stored) }
        return await signedURL(ref)
    }

    func signedURL(_ ref: Ref) async -> URL? {
        if let hit = cached(ref) { return hit.url }
        return await withCheckedContinuation { continuation in
            waiting[ref, default: []].append(continuation)
            if !flushScheduled {
                flushScheduled = true
                Task { @MainActor in
                    try? await Task.sleep(for: .milliseconds(30))
                    await self.flush()
                }
            }
        }
    }

    /// Forget a path's signed URL (its image failed to load: expired, or access changed).
    func invalidate(_ stored: String?) {
        if let ref = Self.ref(fromStored: stored) { entries[ref] = nil }
    }

    /// Signed out: nothing signed for the previous account is reused.
    func reset() { entries = [:] }

    private func flush() async {
        flushScheduled = false
        let batch = waiting
        waiting = [:]
        let byBucket = Dictionary(grouping: batch.keys, by: \.bucket)
        for (bucket, refs) in byBucket {
            let paths = refs.map(\.path).sorted()
            let requestedAt = Date.now
            var urls: [String: URL] = [:]
            for start in stride(from: 0, to: paths.count, by: 100) {
                let chunk = Array(paths[start..<min(start + 100, paths.count)])
                if let got = try? await api.signedImageURLs(bucket: bucket, paths: chunk, expiresIn: Self.lifetime) {
                    urls.merge(got) { a, _ in a }
                }
            }
            for ref in refs {
                let url = urls[ref.path]
                if let url { entries[ref] = (url, requestedAt.addingTimeInterval(TimeInterval(Self.lifetime))) }
                for continuation in batch[ref] ?? [] { continuation.resume(returning: url) }
            }
        }
    }
}

/// AsyncImage for a stored photo URL: signs it through `PhotoURLs`, re-signs before the signature expires,
/// and retries once with a fresh signature when loading fails.
struct StoredImage<Content: View>: View {
    var stored: String?
    var transaction = Transaction()
    @ViewBuilder var content: (AsyncImagePhase) -> Content

    @State private var resolved: URL?
    @State private var attempt = 0

    var body: some View {
        AsyncImage(url: resolved, transaction: transaction) { phase in
            content(phase)
                .onChange(of: phase.isFailure, initial: true) { _, failed in
                    // One retry with a fresh signature (expired, or the cache was stale).
                    guard failed, attempt == 0, PhotoURLs.ref(fromStored: stored) != nil else { return }
                    PhotoURLs.shared.invalidate(stored)
                    attempt += 1
                }
        }
        .task(id: TaskKey(stored: stored, attempt: attempt)) {
            while !Task.isCancelled {
                let url = await PhotoURLs.shared.resolve(stored)
                if resolved != url { resolved = url }
                guard let ref = PhotoURLs.ref(fromStored: stored), let entry = PhotoURLs.shared.cached(ref) else { return }
                // Wake up when the signature is about to expire and pick up a fresh one.
                let wait = entry.expires.timeIntervalSinceNow - PhotoURLs.refreshMargin + 1
                try? await Task.sleep(for: .seconds(max(1, wait)))
            }
        }
    }

    private struct TaskKey: Hashable {
        let stored: String?
        let attempt: Int
    }
}

private extension AsyncImagePhase {
    var isFailure: Bool { if case .failure = self { true } else { false } }
}
