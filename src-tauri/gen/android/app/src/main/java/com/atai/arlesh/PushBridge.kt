package com.atai.arlesh

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import android.webkit.JavascriptInterface
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationManagerCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import org.json.JSONObject

/**
 * What the page can call, as `window.ArleshPush`: whether this build can receive push, the
 * notification permission, the FCM token, the system notification settings, and what a tapped
 * notification asked to open (its Task and channel). The page calls from a background thread. Answers that arrive later
 * reach the page as window events: `arlesh-push-token` and `arlesh-open-task`, each with the value
 * as `detail`. Kept by `proguard-rules.pro`: nothing in Kotlin calls it by name.
 */
class PushBridge(private val activity: MainActivity) {
  /** Whether this build has a Firebase configuration; without one it cannot receive push. */
  @JavascriptInterface
  fun available(): Boolean = FirebaseApp.getApps(activity).isNotEmpty()

  /** Whether the app may post notifications now. */
  @JavascriptInterface
  fun allowed(): Boolean = NotificationManagerCompat.from(activity).areNotificationsEnabled()

  /** Asks for the notification permission (Android 13+); the page re-reads [allowed] on resume. */
  @JavascriptInterface
  fun requestPermission() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    if (activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
    activity.runOnUiThread {
      ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST)
    }
  }

  /** Reads the FCM token and sends it to the page as `arlesh-push-token`. */
  @JavascriptInterface
  fun fetchToken() {
    if (!available()) return
    FirebaseMessaging.getInstance().token.addOnSuccessListener { token -> activity.dispatchToPage("arlesh-push-token", token) }
  }

  /** Opens the system's notification settings for this app, where each channel is switched. */
  @JavascriptInterface
  fun openSettings() {
    val settings = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
      .putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    activity.startActivity(settings)
  }

  /**
   * What a tapped notification opened the app for, once, as JSON `{"task": "task-12", "wait":
   * "<id>", "channel": "agent_question"}` (`task` and `wait` empty when it names none); else an empty string.
   */
  @JavascriptInterface
  fun takeOpenedNotification(): String {
    val opened = pendingOpened
    pendingOpened = null
    return opened ?: ""
  }

  companion object {
    const val TASK_EXTRA = "arlesh_task"
    const val CHANNEL_EXTRA = "arlesh_channel"
    const val WAIT_EXTRA = "arlesh_wait"
    private const val REQUEST = 4721

    /** A tapped notification's Task and channel (as JSON) that the page has not taken yet (a cold start). */
    @Volatile private var pendingOpened: String? = null
    @Volatile private var onToken: ((String) -> Unit)? = null

    /** Remembers the notification a launch intent was tapped from; true when it was one. */
    fun remember(intent: Intent?): Boolean {
      val channel = intent?.getStringExtra(CHANNEL_EXTRA) ?: return false
      val task = intent.getStringExtra(TASK_EXTRA) ?: ""
      val wait = intent.getStringExtra(WAIT_EXTRA) ?: ""
      intent.removeExtra(CHANNEL_EXTRA)
      intent.removeExtra(TASK_EXTRA)
      intent.removeExtra(WAIT_EXTRA)
      pendingOpened = JSONObject().put("task", task).put("wait", wait).put("channel", channel).toString()
      return true
    }

    fun listenForTokens(listener: ((String) -> Unit)?) { onToken = listener }

    fun tokenRotated(token: String) { onToken?.invoke(token) }

    /** The script that dispatches a window event with a string `detail`. */
    fun script(event: String, detail: String): String =
      "window.dispatchEvent(new CustomEvent(${JSONObject.quote(event)},{detail:${JSONObject.quote(detail)}}))"
  }
}
