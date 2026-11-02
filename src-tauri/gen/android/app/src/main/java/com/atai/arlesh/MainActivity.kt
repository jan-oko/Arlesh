package com.atai.arlesh

import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Process
import android.view.RoundedCorner
import android.view.View
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.annotation.RequiresApi
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.WindowInsetsCompat
import java.io.File
import org.json.JSONObject

class MainActivity : TauriActivity() {
  private var webView: WebView? = null

  /** Edge to edge until the page says otherwise, which is the default of the setting. */
  private var mode = BarsMode.EDGE_TO_EDGE
  private var darkTheme = true

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    // Before super.onCreate: the Rust side reads what this leaves while it starts up.
    leaveBoxProvision(intent)
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
      val corners = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) cornersOf(insets) else null
      when (mode) {
        BarsMode.STANDARD -> {
          view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
          pushInsets(0, 0, 0, 0, NO_CORNERS)
        }
        BarsMode.EDGE_TO_EDGE -> {
          view.setPadding(0, 0, 0, if (keyboard) ime.bottom else 0)
          pushInsets(bars.top, if (keyboard) 0 else bars.bottom, bars.left, bars.right, corners)
        }
        BarsMode.IMMERSIVE -> {
          view.setPadding(0, 0, 0, ime.bottom)
          pushInsets(cutout.top, if (ime.bottom > 0) 0 else cutout.bottom, cutout.left, cutout.right, corners)
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

  /**
   * The display's corner radii, which the system reports from Android 12 (API 31); a corner it
   * does not report is 0. Read from the window's insets, so it is right for a folded or rotated screen.
   */
  @RequiresApi(Build.VERSION_CODES.S)
  private fun cornersOf(insets: WindowInsetsCompat): Corners? {
    val windowInsets = insets.toWindowInsets() ?: return null
    fun radius(position: Int) = windowInsets.getRoundedCorner(position)?.radius ?: 0
    return Corners(
      radius(RoundedCorner.POSITION_TOP_LEFT),
      radius(RoundedCorner.POSITION_TOP_RIGHT),
      radius(RoundedCorner.POSITION_BOTTOM_RIGHT),
      radius(RoundedCorner.POSITION_BOTTOM_LEFT),
    )
  }

  /**
   * Writes the insets, in CSS pixels, to the page's `--sat`, `--sab`, `--sal` and `--sar`, and the
   * display's corner radii to `--corner-tl`, `--corner-tr`, `--corner-br` and `--corner-bl`. With
   * no corners (an older Android) the page keeps its own fallback for them.
   */
  private fun pushInsets(top: Int, bottom: Int, left: Int, right: Int, corners: Corners?) {
    val density = resources.displayMetrics.density
    fun css(px: Int) = "${px / density}px"
    var script = "(function(s){s.setProperty('--sat','${css(top)}');" +
      "s.setProperty('--sab','${css(bottom)}');s.setProperty('--sal','${css(left)}');" +
      "s.setProperty('--sar','${css(right)}');"
    if (corners != null) {
      script += "s.setProperty('--corner-tl','${css(corners.topLeft)}');" +
        "s.setProperty('--corner-tr','${css(corners.topRight)}');" +
        "s.setProperty('--corner-br','${css(corners.bottomRight)}');" +
        "s.setProperty('--corner-bl','${css(corners.bottomLeft)}');"
    }
    script += "})(document.documentElement.style)"
    webView?.evaluateJavascript(script, null)
  }

  private companion object {
    // What standard's bars look like behind the app: black-ish on the dark theme, white on light.
    const val STANDARD_DARK = 0xFF121212.toInt()
    const val STANDARD_LIGHT = 0xFFFFFFFF.toInt()

    const val BOX_PACKAGE_PREFIX = "com.atai.arlesh.box."
    const val BOX_URL_EXTRA = "arlesh_box_url"
    const val BOX_TOKEN_EXTRA = "arlesh_box_token"
    // Must match `PROVISION_FILE` in src-tauri/src/client_mode/provision.rs.
    const val BOX_PROVISION_FILE = "box-provision.json"
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
}

/** The display's corner radii in px. */
private data class Corners(val topLeft: Int, val topRight: Int, val bottomRight: Int, val bottomLeft: Int)

/** Standard keeps the app inside the bars, clear of the corners. */
private val NO_CORNERS = Corners(0, 0, 0, 0)
