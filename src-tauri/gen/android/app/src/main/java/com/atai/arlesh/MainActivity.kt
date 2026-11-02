package com.atai.arlesh

import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Process
import android.view.View
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  private var webView: WebView? = null

  /** Edge to edge until the page says otherwise, which is the default of the setting. */
  private var mode = BarsMode.EDGE_TO_EDGE
  private var darkTheme = true

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // The window always extends under the bars (that is what lets the setting switch at runtime
    // with no flicker); what changes is who keeps clear of them:
    //  - standard: this padding does, by the bars' real sizes, and the page sees 0;
    //  - edge to edge: the page does, by the insets pushed into its CSS;
    //  - immersive: the bars are hidden, so only a display cutout is kept clear of, by the page.
    // The soft keyboard is padded for in every mode, so sheets resize above it instead of under it.
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
      )
      val cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
      // With the keyboard up the gesture bar is behind it: pad by the keyboard, and the page's
      // bottom inset is 0 so it is not counted twice.
      val keyboard = ime.bottom > bars.bottom
      when (mode) {
        BarsMode.STANDARD -> {
          view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
          pushInsets(0, 0, 0, 0)
        }
        BarsMode.EDGE_TO_EDGE -> {
          view.setPadding(0, 0, 0, if (keyboard) ime.bottom else 0)
          pushInsets(bars.top, if (keyboard) 0 else bars.bottom, bars.left, bars.right)
        }
        BarsMode.IMMERSIVE -> {
          view.setPadding(0, 0, 0, ime.bottom)
          pushInsets(cutout.top, if (ime.bottom > 0) 0 else cutout.bottom, cutout.left, cutout.right)
        }
      }
      WindowInsetsCompat.CONSUMED
    }
  }

  override fun onWebViewCreate(webView: WebView) {
    this.webView = webView
    webView.addJavascriptInterface(SystemBarsBridge(this), "ArleshBars")
  }

  /**
   * Sets how the app sits against the system bars, and the icons' shade to read on the app's own
   * theme. Called from [SystemBarsBridge], on the main thread, whenever the page's wanted mode
   * changes and when it loads.
   */
  fun applySystemBars(newMode: BarsMode, dark: Boolean) {
    mode = newMode
    darkTheme = dark
    val controller = WindowCompat.getInsetsController(window, window.decorView)
    if (newMode == BarsMode.IMMERSIVE) {
      // A swipe from the edge shows the bars over the content for a moment; the content does not move.
      controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      controller.hide(WindowInsetsCompat.Type.systemBars())
    } else {
      controller.show(WindowInsetsCompat.Type.systemBars())
    }
    val transparent = newMode == BarsMode.EDGE_TO_EDGE
    window.statusBarColor = Color.TRANSPARENT
    window.navigationBarColor = Color.TRANSPARENT
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      window.isNavigationBarContrastEnforced = !transparent
    }
    // Standard's opaque bars are the content view's background showing through the padding.
    findViewById<View>(android.R.id.content)
      .setBackgroundColor(if (dark) STANDARD_DARK else STANDARD_LIGHT)
    controller.isAppearanceLightStatusBars = !dark
    controller.isAppearanceLightNavigationBars = !dark
    // Measure again with the new mode: the listener above does the padding and the page's insets.
    ViewCompat.requestApplyInsets(findViewById(android.R.id.content))
  }

  /** Writes the insets, in CSS pixels, to the page's `--sat`, `--sab`, `--sal` and `--sar`. */
  private fun pushInsets(top: Int, bottom: Int, left: Int, right: Int) {
    val density = resources.displayMetrics.density
    fun css(px: Int) = "${px / density}px"
    val script = "(function(s){s.setProperty('--sat','${css(top)}');" +
      "s.setProperty('--sab','${css(bottom)}');s.setProperty('--sal','${css(left)}');" +
      "s.setProperty('--sar','${css(right)}');})(document.documentElement.style)"
    webView?.evaluateJavascript(script, null)
  }

  private companion object {
    // What standard's bars look like behind the app: black-ish on the dark theme, white on light.
    const val STANDARD_DARK = 0xFF121212.toInt()
    const val STANDARD_LIGHT = 0xFFFFFFFF.toInt()
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
