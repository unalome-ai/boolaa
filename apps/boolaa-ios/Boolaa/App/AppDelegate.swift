import UIKit
import UserNotifications

/// APNs registration callbacks and the notification-center delegate (docs/push-notifications.md §8, iOS).
/// The delegate is set before launch finishes, so a tap that cold-starts the app is still delivered.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.setNotificationCategories(PushRules.categories)
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { await PushCenter.shared.didReceive(token: deviceToken) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: any Error) {
        // No APNs (no network, no entitlement in an unsigned build): the app works without pushes.
    }

    // MARK: UNUserNotificationCenterDelegate

    /// In the foreground: a banner, except for a chat push of the chat that is on screen.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        let payload = PushPayload(userInfo: notification.request.content.userInfo)
        return await PushCenter.shared.presentation(for: payload)
    }

    /// A tap: route to the bubble and screen in the payload.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            didReceive response: UNNotificationResponse) async {
        guard response.actionIdentifier == UNNotificationDefaultActionIdentifier,
              let payload = PushPayload(userInfo: response.notification.request.content.userInfo) else { return }
        await PushCenter.shared.open(payload)
    }
}
