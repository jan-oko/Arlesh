package com.atai.arlesh

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import android.os.Process
import androidx.core.content.IntentCompat

/**
 * Runs in its own process (see the manifest): kills the app's main process, then starts the app
 * again, which comes up as a new process. [MainActivity.restartApp] starts it.
 */
class RestartActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val next = IntentCompat.getParcelableExtra(intent, NEXT, Intent::class.java)
    val pid = intent.getIntExtra(PID, -1)
    if (pid > 0) Process.killProcess(pid)
    if (next != null) startActivity(next)
    finish()
    Runtime.getRuntime().exit(0)
  }

  companion object {
    const val NEXT = "next"
    const val PID = "pid"
  }
}
