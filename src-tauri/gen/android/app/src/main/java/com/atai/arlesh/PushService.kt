package com.atai.arlesh

import android.Manifest
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * Receives the server's data messages and builds the notification, so the app owns the channel, the
 * text and the tap. A message carries `channel`, `tag` (the fact's key, so a repeat replaces) and,
 * for a Task, `task` (its board key) and `title`. Tapping it opens the app at that Task. Kept by
 * `proguard-rules.pro`: Firebase starts it by the name in the manifest.
 */
class PushService : FirebaseMessagingService() {
  override fun onMessageReceived(message: RemoteMessage) {
    val data = message.data
    val channel = data["channel"] ?: return
    if (!PushChannels.exists(channel)) return
    val text = PushChannels.text(this, channel, data["title"]) ?: return
    if (!canPost()) return
    PushChannels.ensure(this)

    val open = Intent(this, MainActivity::class.java).apply {
      // Explicit and immutable: no other app can send the link, or change what it opens.
      flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
      data["task"]?.let { putExtra(PushBridge.TASK_EXTRA, it) }
    }
    val tag = data["tag"] ?: channel
    val tap = PendingIntent.getActivity(
      this, tag.hashCode(), open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
    val notification = NotificationCompat.Builder(this, channel)
      .setSmallIcon(R.drawable.ic_stat_arlesh)
      .setContentTitle(getString(R.string.app_name))
      .setContentText(text)
      .setStyle(NotificationCompat.BigTextStyle().bigText(text))
      .setContentIntent(tap)
      .setAutoCancel(true)
      .build()
    NotificationManagerCompat.from(this).notify(tag, 0, notification)
  }

  /** A rotated token is kept for the next start, which registers it; a running page hears at once. */
  override fun onNewToken(token: String) {
    PushBridge.tokenRotated(token)
  }

  private fun canPost(): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
      ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
        PackageManager.PERMISSION_GRANTED
}
