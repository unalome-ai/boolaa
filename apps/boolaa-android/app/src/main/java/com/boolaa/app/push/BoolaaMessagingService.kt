package com.boolaa.app.push

import com.boolaa.app.BoolaaApplication
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * FCM entry point. Background pushes carry `notification`, so the system draws them (channel and tag from the server);
 * this only sees pushes while the app is in the foreground, and new tokens.
 */
class BoolaaMessagingService : FirebaseMessagingService() {
    private val push get() = (application as BoolaaApplication).container.push

    override fun onNewToken(token: String) {
        push.onNewToken(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val n = message.notification
        push.showForeground(
            title = n?.title ?: message.data["title"],
            body = n?.body ?: message.data["body"],
            data = message.data,
            channelId = n?.channelId,
            tag = n?.tag,
        )
    }
}
