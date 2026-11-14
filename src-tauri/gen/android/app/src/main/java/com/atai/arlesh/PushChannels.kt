package com.atai.arlesh

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build

/**
 * The five notification channels, one per event type the server pushes. The user switches each in
 * Android's system settings; the server tags every message with its channel id and stores no toggles.
 * Ids match the server's `Channel` (`arlesh.server.ports.push.push_store`).
 */
object PushChannels {
  private class Spec(val id: String, val name: Int, val importance: Int)

  private val CHANNELS = listOf(
    Spec("agent_question", R.string.channel_agent_question, NotificationManager.IMPORTANCE_HIGH),
    Spec("task_overdue", R.string.channel_task_overdue, NotificationManager.IMPORTANCE_HIGH),
    Spec("task_generated", R.string.channel_task_generated, NotificationManager.IMPORTANCE_DEFAULT),
    Spec("capacity_locked", R.string.channel_capacity_locked, NotificationManager.IMPORTANCE_DEFAULT),
    Spec("capacity_cleared", R.string.channel_capacity_cleared, NotificationManager.IMPORTANCE_DEFAULT),
  )

  /** Creates the channels. Idempotent: a channel that exists keeps what the user changed. */
  fun ensure(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    for (spec in CHANNELS) {
      manager.createNotificationChannel(
        NotificationChannel(spec.id, context.getString(spec.name), spec.importance)
      )
    }
  }

  /** Whether `id` is one of the channels. */
  fun exists(id: String): Boolean = CHANNELS.any { it.id == id }

  /** The notification's text for a message on channel `id` about a Task titled `title`. */
  fun text(context: Context, id: String, title: String?): String? {
    val task = title ?: ""
    return when (id) {
      "agent_question" -> context.getString(R.string.push_agent_question, task)
      "task_overdue" -> context.getString(R.string.push_task_overdue, task)
      "task_generated" -> context.getString(R.string.push_task_generated, task)
      "capacity_locked" -> context.getString(R.string.push_capacity_locked)
      "capacity_cleared" -> context.getString(R.string.push_capacity_cleared)
      else -> null
    }
  }
}
