import Testing
import CoreGraphics
@testable import Boolaa

/// Wide screens (spec "Wide screens"): the chat gets its own pane from 820 pt; phones stay single-column.
@MainActor
struct ShellLayoutTests {
    @Test func phonesStaySingleColumn() {
        for width: CGFloat in [320, 375, 393, 440] { #expect(!ShellLayout.isWide(width: width)) }
    }

    @Test func unfoldedDuoIsWide() {
        #expect(ShellLayout.isWide(width: 820))
        #expect(ShellLayout.isWide(width: 951))
    }

    @Test func chatPaneWidthIsClamped() {
        #expect(ShellLayout.chatWidth(totalWidth: 820) == 344)
        #expect(ShellLayout.chatWidth(totalWidth: 951) == 399)
        #expect(ShellLayout.chatWidth(totalWidth: 1400) == 440)
        #expect(ShellLayout.chatWidth(totalWidth: 700) == 340)
    }

    @Test func dockBarFillsTheRowWithoutTheChatButton() {
        #expect(DockLayout.barWidth(rowWidth: 550, withChat: false) == CGFloat(518))
        #expect(DockLayout.barWidth(rowWidth: 550) == CGFloat(518) - DockLayout.chatOrb - DockLayout.gap)
    }

    @Test func embeddedChatPushesNothing() {
        let router = ShellRouter()
        router.open(.chat)
        #expect(router.path == [.chat])
        router.chatEmbedded = true
        #expect(router.path.isEmpty, "unfolding drops the pushed chat: the pane shows it")
        router.open(.chat)
        router.openChat(draft: "Is it free?")
        #expect(router.path.isEmpty)
        #expect(router.chatDraft?.text == "Is it free?", "the pane picks the draft up")
        router.open(.links)
        #expect(router.path == [.links])
    }
}
