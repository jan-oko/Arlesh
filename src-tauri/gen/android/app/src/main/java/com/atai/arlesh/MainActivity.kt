package com.atai.arlesh

import android.content.Intent
import android.os.Bundle
import android.os.Process
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
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
}
