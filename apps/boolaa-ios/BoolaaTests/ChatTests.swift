import Foundation
import Testing
@testable import Boolaa

/// Chat improvements (docs/boolaa-spec.md, "Chat"; 20261123120000_chat_improvements.sql): decoding,
/// page / live merge rules, the "New messages" divider, badges, photos and strings.
@Suite("Chat: models and timeline")
struct ChatTimelineTests {
    private static let alice = UserProfile(id: Seed.alice, name: "Alice", avatar: nil)

    private func id(_ n: Int) -> UUID { UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", n))! }

    private func msg(_ n: Int, at seconds: TimeInterval, from sender: UUID = Seed.alice, _ text: String = "x",
                     image: String? = nil, deleted: Bool = false, author: UserProfile? = ChatTimelineTests.alice) -> ChatMessage {
        ChatMessage(id: id(n), bubbleId: Seed.flatmates, senderId: sender, content: deleted ? "" : text,
                    createdAt: Date(timeIntervalSince1970: seconds), imagePath: deleted ? nil : image,
                    deletedAt: deleted ? Date(timeIntervalSince1970: seconds + 1) : nil, sender: author)
    }

    // MARK: Decoding

    @Test func decodesPhotoAndDeletedColumns() throws {
        let json = """
        [{"id":"00000000-0000-0000-0000-000000000001","bubble_id":"aaaaaaaa-0000-0000-0000-000000000001",
          "sender_id":"11111111-1111-1111-1111-111111111111","content":"",
          "created_at":"2026-11-23T10:00:00.123456+00:00","image_path":"11111111-1111-1111-1111-111111111111/a.jpg",
          "deleted_at":null,"sender":{"id":"11111111-1111-1111-1111-111111111111","name":"Alice","avatar":null}},
         {"id":"00000000-0000-0000-0000-000000000002","bubble_id":"aaaaaaaa-0000-0000-0000-000000000001",
          "sender_id":"22222222-2222-2222-2222-222222222222","content":"","created_at":"2026-11-23T10:00:01+00:00",
          "image_path":null,"deleted_at":"2026-11-23T10:05:00.5+00:00"}]
        """
        let rows = try BoolaaJSON.decoder.decode([ChatMessage].self, from: Data(json.utf8))
        #expect(rows[0].imagePath == "11111111-1111-1111-1111-111111111111/a.jpg")
        #expect(rows[0].deletedAt == nil && !rows[0].isDeleted)
        #expect(rows[0].sender?.name == "Alice")
        #expect(rows[1].isDeleted)
        #expect(rows[1].imagePath == nil && rows[1].sender == nil)
    }

    @Test func oldRowsAndRealtimeRecordsStillDecode() throws {
        // Fixtures captured before the migration have neither column.
        let messages = try Fixture.decode([ChatMessage].self, "chat")
        #expect(messages.allSatisfy { $0.imagePath == nil && !$0.isDeleted })
        let record = try Fixture.decode(ChatMessage.self, "realtime_chat_record")
        #expect(!record.isDeleted)
    }

    @Test func newMessageEncodesImagePathOnlyWhenSet() throws {
        let text = try JSONSerialization.jsonObject(with: BoolaaJSON.encoder.encode(
            NewChatMessage(bubbleId: Seed.flatmates, senderId: Seed.alice, content: "hi"))) as? [String: Any]
        #expect(text?["image_path"] == nil)
        let photo = try JSONSerialization.jsonObject(with: BoolaaJSON.encoder.encode(
            NewChatMessage(bubbleId: Seed.flatmates, senderId: Seed.alice, content: "", imagePath: "u/p.jpg"))) as? [String: Any]
        #expect(photo?["image_path"] as? String == "u/p.jpg")
        #expect(photo?["content"] as? String == "")
    }

    @Test func decodesUnreadRows() throws {
        let json = """
        [{"bubble_id":"aaaaaaaa-0000-0000-0000-000000000001","unread_count":100,"last_read_at":"2026-11-23T09:00:00.654321+00:00"}]
        """
        let rows = try BoolaaJSON.decoder.decode([ChatUnread].self, from: Data(json.utf8))
        #expect(rows.first?.bubbleId == Seed.flatmates)
        #expect(rows.first?.unreadCount == 100)
        #expect(rows.first?.lastReadAt == BoolaaJSON.parseTimestamp("2026-11-23T09:00:00.654+00:00"))
    }

    @Test func deletedCopyWipesTextAndPhoto() {
        let gone = msg(1, at: 10, "secret", image: "u/a.jpg").asDeleted()
        #expect(gone.isDeleted && gone.content.isEmpty && gone.imagePath == nil)
        #expect(gone.sender?.name == "Alice")
    }

    // MARK: Merge

    @Test func insertKeepsChronologicalOrderAndDedupes() {
        var list = [msg(1, at: 10), msg(3, at: 30)]
        list = ChatTimeline.upsert(list, msg(2, at: 20, author: nil))
        #expect(list.map(\.id) == [id(1), id(2), id(3)])
        list = ChatTimeline.upsert(list, msg(4, at: 40))
        #expect(list.map(\.id) == [id(1), id(2), id(3), id(4)])
        // The realtime echo of our own insert changes nothing.
        #expect(ChatTimeline.upsert(list, msg(4, at: 40, author: nil)) == list)
        // Equal timestamps keep arrival order.
        list = ChatTimeline.upsert(list, msg(5, at: 40))
        #expect(list.suffix(2).map(\.id) == [id(4), id(5)])
    }

    @Test func updateReplacesInPlaceKeepingSender() {
        let list = [msg(1, at: 10), msg(2, at: 20, "hello", image: "u/a.jpg"), msg(3, at: 30)]
        let out = ChatTimeline.applyUpdate(list, msg(2, at: 20, deleted: true, author: nil))
        #expect(out.map(\.id) == list.map(\.id))
        #expect(out[1].isDeleted && out[1].content.isEmpty && out[1].imagePath == nil)
        #expect(out[1].sender?.name == "Alice")
    }

    @Test func updateOfAMessageNotLoadedIsIgnored() {
        let list = [msg(5, at: 50), msg(6, at: 60)]
        #expect(ChatTimeline.applyUpdate(list, msg(1, at: 10, deleted: true)) == list)
    }

    @Test func olderPagePrependsWithoutDuplicates() {
        let list = [msg(3, at: 30), msg(4, at: 40)]
        let older = [msg(1, at: 10), msg(2, at: 20), msg(3, at: 30)]
        #expect(ChatTimeline.prepend(list, olderPage: older).map(\.id) == [id(1), id(2), id(3), id(4)])
    }

    @Test func shortPageMeansStartOfChat() {
        #expect(BoolaaAPI.chatPageSize == 50)
        #expect(ChatTimeline.reachedStart(pageCount: 49))
        #expect(ChatTimeline.reachedStart(pageCount: 0))
        #expect(!ChatTimeline.reachedStart(pageCount: 50))
    }

    @Test @MainActor func modelMergeAndUpdate() {
        let model = ChatModel()
        model.merge(msg(2, at: 20))
        model.merge(msg(1, at: 10))
        model.update(msg(2, at: 20, deleted: true, author: nil))
        #expect(model.messages.map(\.id) == [id(1), id(2)])
        #expect(model.messages[1].isDeleted && model.messages[1].sender?.name == "Alice")
    }

    // MARK: Divider

    @Test func dividerGoesAboveFirstNewMessageFromSomeoneElse() {
        let me = Seed.alice
        let list = [msg(1, at: 10, from: Seed.bob), msg(2, at: 20, from: me), msg(3, at: 30, from: Seed.bob, deleted: true),
                    msg(4, at: 40, from: Seed.bob), msg(5, at: 50, from: Seed.carol)]
        // Marker at message 1: my own message 2 and the deleted 3 don't count.
        #expect(ChatTimeline.dividerID(list, lastReadAt: Date(timeIntervalSince1970: 10), me: me) == id(4))
        #expect(ChatTimeline.dividerID(list, lastReadAt: Date(timeIntervalSince1970: 5), me: me) == id(1))
        // Everything read, or no marker: no divider.
        #expect(ChatTimeline.dividerID(list, lastReadAt: Date(timeIntervalSince1970: 50), me: me) == nil)
        #expect(ChatTimeline.dividerID(list, lastReadAt: nil, me: me) == nil)
    }

    // MARK: Badges

    @Test(arguments: [(0, nil), (-1, nil), (1, "1"), (42, "42"), (99, "99"), (100, "99+"), (250, "99+")] as [(Int, String?)])
    func badgeText(count: Int, expected: String?) {
        #expect(ChatUnread.badgeText(count) == expected)
    }

    // MARK: Photos

    @Test func chatBucketUsesTheFoodLimitsAndIsCleanedOnAccountDeletion() {
        #expect(BoolaaAPI.ImageBucket.chat.rawValue == "chat.images")
        #expect(ImageCompression.maxSide(for: .chat) == 1600)
        #expect(ImageCompression.maxBytes(for: .chat) == 5 * 1024 * 1024)
        #expect(BoolaaAPI.userBuckets.map(\.rawValue) == ["avatars", "food.images", "market.images", "chat.images"])
        #expect(!BoolaaAPI.userBuckets.contains(.bubbles))
    }

    @Test func chatImagePathIsInTheSendersFolder() {
        let file = UUID()
        let path = BoolaaAPI.chatImagePath(userID: Seed.alice, fileID: file)
        #expect(path == "11111111-1111-1111-1111-111111111111/\(file.uuidString.lowercased()).jpg")
        #expect(path.range(of: "^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,128}$", options: .regularExpression) != nil)
    }

    @Test func photoPathsSkipDeletedMessages() {
        let list = [msg(1, at: 10, image: "u/a.jpg"), msg(2, at: 20, image: "u/b.jpg", deleted: true), msg(3, at: 30)]
        #expect(ChatTimeline.imagePaths(list) == ["u/a.jpg"])
    }

    @Test @MainActor func signedURLsAreCachedPerPath() {
        let cache = ChatImageURLs()
        #expect(cache.missing(["u/b.jpg", "u/a.jpg", "u/a.jpg"]) == ["u/a.jpg", "u/b.jpg"])
        #expect(cache.url(for: "u/a.jpg") == nil)
        #expect(cache.url(for: nil) == nil)
    }

    @Test func homeShowsPhotoLabelForPhotoWithoutCaption() {
        #expect(FeedCard.messageTitle(msg(1, at: 1, "", image: "u/a.jpg")) == String(localized: "Photo"))
        #expect(FeedCard.messageTitle(msg(1, at: 1, "caption", image: "u/a.jpg")) == "caption")
        #expect(FeedCard.messageTitle(msg(1, at: 1, "text")) == "text")
    }
}

@Suite("Chat: strings and errors")
struct ChatStringsTests {
    private func bundle(_ lang: String) throws -> Bundle {
        let path = try #require(Bundle.main.path(forResource: lang, ofType: "lproj"))
        return try #require(Bundle(path: path))
    }

    /// docs/i18n-glossary.md, "Chat". English needs no entry: the key is the English text.
    static let glossary: [(key: String, ro: String, fr: String, es: String, it: String)] = [
        ("This message was deleted", "Mesajul a fost șters", "Ce message a été supprimé", "Este mensaje se ha eliminado", "Questo messaggio è stato eliminato"),
        ("Delete message", "Șterge mesajul", "Supprimer le message", "Eliminar mensaje", "Elimina messaggio"),
        ("Delete this message?", "Ștergi mesajul?", "Supprimer ce message ?", "¿Eliminar este mensaje?", "Eliminare questo messaggio?"),
        ("It disappears for everyone in the bubble.", "Dispare pentru toți cei din bulă.", "Il disparaît pour tout le monde dans la bulle.",
         "Desaparece para todos en la burbuja.", "Sparisce per tutti nella bolla."),
        ("Delete", "Șterge", "Supprimer", "Eliminar", "Elimina"),
        ("New messages", "Mesaje noi", "Nouveaux messages", "Mensajes nuevos", "Nuovi messaggi"),
        ("Loading older messages…", "Se încarcă mesajele mai vechi…", "Chargement des anciens messages…", "Cargando mensajes anteriores…",
         "Caricamento dei messaggi precedenti…"),
        ("That's the start of the chat", "Aici începe chatul", "C'est le début de la discussion", "Aquí empieza el chat", "Qui inizia la chat"),
        ("Add a photo", "Adaugă o fotografie", "Ajouter une photo", "Añadir una foto", "Aggiungi una foto"),
        ("Remove photo", "Elimină fotografia", "Retirer la photo", "Quitar la foto", "Rimuovi la foto"),
        ("Photo", "Fotografie", "Photo", "Foto", "Foto"),
        ("That message no longer exists.", "Mesajul nu mai există.", "Ce message n'existe plus.", "Ese mensaje ya no existe.", "Questo messaggio non esiste più."),
    ]

    @Test func glossaryTextsInEveryLanguage() throws {
        for entry in Self.glossary {
            for (lang, expected) in [("ro", entry.ro), ("fr", entry.fr), ("es", entry.es), ("it", entry.it)] {
                #expect(try bundle(lang).localizedString(forKey: entry.key, value: "⟨missing⟩", table: nil) == expected, "\(entry.key) [\(lang)]")
            }
        }
    }

    @Test(arguments: [
        ("en", 1, "1 unread message"), ("en", 5, "5 unread messages"),
        ("ro", 1, "1 mesaj necitit"), ("ro", 3, "3 mesaje necitite"), ("ro", 25, "25 de mesaje necitite"),
        ("fr", 1, "1 message non lu"), ("fr", 2, "2 messages non lus"),
        ("es", 1, "1 mensaje sin leer"), ("es", 7, "7 mensajes sin leer"),
        ("it", 1, "1 messaggio non letto"), ("it", 99, "99 messaggi non letti"),
    ])
    func unreadLabelPlurals(lang: String, count: Int, expected: String) throws {
        #expect(String(localized: "\(count) unread messages", bundle: try bundle(lang), locale: Locale(identifier: lang)) == expected)
    }

    @Test func messageNotFoundMapsToChatMessageGone() throws {
        #expect(UserFacingError.classify(message: "message not found", code: "P0001") == .chatMessageGone)
        #expect(UserFacingError.classify(message: "member not found", code: nil) == .memberNotFound)
        #expect(try bundle("ro").localizedString(forKey: UserFacingError.chatMessageGone.message.key,
                                                 value: "⟨missing⟩", table: nil) == "Mesajul nu mai există.")
    }
}
