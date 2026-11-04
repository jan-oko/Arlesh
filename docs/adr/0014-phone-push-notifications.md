# The server pushes board events to the phone through FCM, by diffing the derived board

Status: accepted (2026-11-04). Behaviour: [Notifications](../spec/notifications.md).

The phone gets a notification when an agent asks a question, a Task becomes Overdue, a task is
generated, or the agent capacity lock is set or cleared, with the app in the background or closed.
Settled with the user on 2026-10-31 and 2026-11-04.

## Decisions

1. **Firebase Cloud Messaging, from the server.** `arlesh-server` sends through the FCM HTTP v1 API
   with a service-account key (`ARLESH_FCM_CREDENTIALS_FILE`). Without it the server runs and says
   pushes are off. Nothing about Firebase is committed: `google-services.json` reaches the APK from
   a CI secret (`GOOGLE_SERVICES_JSON`, base64) and a box build writes its own.
2. **State, not a queue.** A look derives the board with the core's rules and compares it with what
   each device was told, recorded per device in the database (`push_sent`, migration 0099). New
   facts are sent, and a fact is recorded only once FCM accepts it. So a restart never re-sends, a
   failed send is retried at the next look, and a fact that stops holding is forgotten so that
   holding again is news. A device that registers is taken to have been told what is already true.
3. **The rules are the core's.** Reading the facts off the derived board and the comparison are
   pure functions in `arlesh-core` (`push::rules`), reached from Python through the bindings. The
   server holds no rule of its own: it sends, records and schedules.
4. **What wakes a look.** Every committed write (after the board is quiet for a second), the scope
   boundaries (each part of day, the 02:00 day start; the moments come from the core's scope rules)
   and a coarse tick of about five minutes. Time alone makes a Task Overdue, an occurrence appear
   and a check fall due, so a write-driven design alone would miss them.
5. **Toggles are Android's.** One notification channel per event type, switched in the system
   settings. The server stores no toggles and sends every event to every registered device, tagged
   with its channel.
6. **Data messages.** The app's own service builds the notification, so it owns the channel, the
   text and the tap. The message carries the channel, a tag (the fact's key) and, for a Task, its
   board key and title.
7. **A device registers under its own client.** `PUT /devices/current/push` with its FCM token, over
   its pairing token. Revoking a device deletes its registration and record in the same transaction.
   One token belongs to one device.

## Consequences

- The tables are server-only, like `server_tokens`: not read by the desktop app, not journaled.
- A device is not told of an event it caused. It is told of everything, by design: the server does
  not know which device is looking at the board.
- Several quick changes between two looks collapse: a lock set and cleared inside the quiet window is
  never sent.
- A generated task that is already Overdue is two notifications, one on each channel.
- `GET /push` says whether the server can push; the app's Notifications settings page reads it.
