package com.atai.arlesh

import android.content.Intent
import android.os.Bundle
import android.os.Process
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import java.io.File
import org.json.JSONObject

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    // Before super.onCreate: the Rust side reads what this leaves while it starts up.
    leaveBoxProvision(intent)
    super.onCreate(savedInstanceState)

    // Edge to edge draws under the status bar, the navigation bar and the soft keyboard. Pad the
    // content by all three, so the page keeps clear of the bars and its sheets resize above the
    // keyboard instead of being covered by it.
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val covered = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime()
      )
      view.setPadding(covered.left, covered.top, covered.right, covered.bottom)
      WindowInsetsCompat.CONSUMED
    }
  }

  /**
   * Starts the app afresh in a new process. Tauri's own restart spawns the app's binary, which
   * Android does not allow, and so only exits. Called from Rust (JNI) when the mode is switched.
   */
  fun restartApp() {
    val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
    val restart = Intent(this, RestartActivity::class.java)
    restart.putExtra(RestartActivity.NEXT, launch)
    restart.putExtra(RestartActivity.PID, Process.myPid())
    startActivity(restart)
  }

  /**
   * A box build (applicationId `com.atai.arlesh.box.*`, made by `npm run box`) is launched with the
   * server URL and token as intent extras; leave them for the Rust startup (`client_mode::provision`)
   * so the build comes up already connected, without the PIN flow. The release app never does
   * this: it ignores the extras, so no intent can bind it to a server. The extras are removed from
   * the intent so the token is not kept in the task's saved intent.
   */
  private fun leaveBoxProvision(launch: Intent?) {
    if (launch == null || !packageName.startsWith(BOX_PACKAGE_PREFIX)) return
    val url = launch.getStringExtra(BOX_URL_EXTRA)
    val token = launch.getStringExtra(BOX_TOKEN_EXTRA)
    launch.removeExtra(BOX_TOKEN_EXTRA)
    if (url.isNullOrBlank() || token.isNullOrBlank()) return
    val body = JSONObject().put("url", url).put("token", token).toString()
    File(dataDir, BOX_PROVISION_FILE).writeText(body)
  }

  private companion object {
    const val BOX_PACKAGE_PREFIX = "com.atai.arlesh.box."
    const val BOX_URL_EXTRA = "arlesh_box_url"
    const val BOX_TOKEN_EXTRA = "arlesh_box_token"
    // Must match `PROVISION_FILE` in src-tauri/src/client_mode/provision.rs.
    const val BOX_PROVISION_FILE = "box-provision.json"
  }
}
