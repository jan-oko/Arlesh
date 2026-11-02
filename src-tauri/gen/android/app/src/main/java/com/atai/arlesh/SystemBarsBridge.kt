package com.atai.arlesh

import android.webkit.JavascriptInterface

/**
 * What the page can call, as `window.ArleshBars`: the web side tells the activity how the app
 * should sit against the system bars (`standard`, `edgeToEdge` or `immersive`). The page calls from
 * a background thread, so the activity is asked on the main one. Kept by `proguard-rules.pro`:
 * nothing in Kotlin calls it by name.
 */
class SystemBarsBridge(private val activity: MainActivity) {
  @JavascriptInterface
  fun setSystemBars(mode: String, darkTheme: Boolean) {
    val parsed = BarsMode.fromName(mode) ?: return
    activity.runOnUiThread { activity.applySystemBars(parsed, darkTheme) }
  }
}

/** How the app sits against the system bars. Names match the web side's `SystemBarsMode`. */
enum class BarsMode(val named: String) {
  STANDARD("standard"),
  EDGE_TO_EDGE("edgeToEdge"),
  IMMERSIVE("immersive");

  companion object {
    fun fromName(name: String): BarsMode? = values().firstOrNull { it.named == name }
  }
}
