# Notifications

*One area of the [Arlesh design specification](../../SPEC.md).*

Arlesh tells the user's phone when something on the board needs them, through **Firebase Cloud
Messaging** (FCM), so a notification arrives with the app in the background or closed. The desktop
app shows the same events natively while it runs ([On the desktop](#on-the-desktop)).
`arlesh-server` sends it; the phone runs only in Client mode ([Client Mode](client-mode.md)), so
push needs a server. Settled with the user on 2026-10-31 and 2026-11-04; the reasons are in
[ADR 0014](../adr/0014-phone-push-notifications.md).

## What notifies

Five events, each its own Android notification channel:

| Channel id | Event |
| --- | --- |
| `agent_question` | An agent asked a question: a Task went to Review (see [Resources](resources.md), *Expectations*) |
| `task_overdue` | A Task became Overdue |
| `task_generated` | A task was generated: a Habit occurrence, a wait's check task |
| `capacity_locked` | The agent capacity lock was set |
| `capacity_cleared` | The agent capacity lock was cleared |

Each notification of a Task carries the Task's title. Tapping a notification of an agent's question
opens the **List View on the Review preset** with the Task that holds the question selected and
scrolled into view ([Opening the Review list](#opening-the-review-list)); tapping any other opens
its Task in the app.

## Toggles

The user switches each channel in **Android's system settings**; Settings → Notifications in the
app links there. The server stores no toggles: it sends every event to every registered device,
tagged with its channel, and Android drops a channel the user switched off.

## How the server knows

The server **diffs the derived board** against a per-device record of what it already told. Reading
the facts and comparing are the core's pure rules (`arlesh_core::push::rules`); the server only
sends, records and schedules.

- **Facts.** An open agentic question (`question:<wait>`), an Overdue Task (`overdue:<task>`), a
  generated Task that is not done or archived (`generated:<task>`), and the lock (`capacity`).
- **Looks.** A look runs shortly after every committed write (once the board has been quiet for a
  second), at the scope boundaries (each part of day, the 02:00 day start) and every five minutes.
  Time alone makes a Task Overdue or an occurrence appear, so a write is not the only trigger.
- **Exactly once.** A fact is recorded per device (`push_sent`) only after FCM accepts the message.
  A restart finds the record and sends nothing again; a failed send is not recorded and is tried at
  the next look. A fact that stops holding is forgotten, so holding again is news. The lock is
  recorded as `locked` or `clear`, and only a change is news.
- **A new device** is taken to have been told everything already true when it registers, so it
  hears only of what happens after. A known device that registers again (a rotated token, a
  restart) keeps its record and is still owed what it missed.

## Devices

Each device registers its FCM token under its own client, the name its pairing token carries:

- `PUT /devices/current/push` `{fcm_token}` registers or replaces; `{"new": bool}`.
- `DELETE /devices/current/push` unregisters.
- `GET /push` says `{enabled, project_id}`: whether the server has credentials.
- `GET /devices` gains `push: bool` per device.

A token belongs to one device: registering a token another device holds drops the other. A token
FCM no longer knows is dropped. **Revoking a device** deletes its registration and its record in the
same transaction. The tables (`push_devices`, `push_sent`, migration 0099) are server-only and not
journaled.

## Credentials

`ARLESH_FCM_CREDENTIALS_FILE` names a Firebase service-account key (in a container, a mounted
secret). Unset, the server runs, takes registrations, sends nothing and logs that pushes are off.
Set but unusable, the server refuses to start and says why. Sending is the FCM HTTP v1 API with an
OAuth token minted from the key. Every message is a high-priority **data** message
(`channel`, `tag`, and for a Task `task` and `title`), so the app builds the notification.

## On the phone

- **Firebase.** The Firebase project is `control-7457b`, the package `com.atai.arlesh`.
  `google-services.json` is never committed. CI writes it from the secret `GOOGLE_SERVICES_JSON`
  (base64); the Gradle google-services plugin is applied only when the file exists, so a build
  without it compiles and simply cannot receive push. A box build's own per-branch file is used the
  same way.
- **Permission.** On Android 13 and later Settings → Notifications asks for `POST_NOTIFICATIONS`;
  nothing asks at startup.
- **Channels.** The five are created at startup, named in the user's language.
- **Registration.** On each start, in Client mode on Android, the app reads its FCM token and
  registers it with the server (and again when FCM rotates it).
- **The tap** opens the app at what the notification names: for an agent's question the Review list
  ([Opening the Review list](#opening-the-review-list)), for any other the Task, selected in the
  active tab. The intent carries the Task's board key and the channel, and is explicit to Arlesh's
  own activity; there is no link another app could send.

## On the desktop

The desktop app shows a native notification for the same five events while it is running, tray
included, in both modes. There is no FCM: the app is the device. Task `2df`; the user's ruling
(2026-11-13) is "same as the phone": whatever the phone's rules notify for, the desktop does too,
with the same defaults, generated Tasks included.

- **Where it runs.** One service for the whole process (`src-tauri/src/notifications.rs`), fed from
  the one place every window is told of a change event (`commands::board::emit_board_change`). A
  window never triggers a notification, so several windows produce one.
- **Both modes follow change events** ([ADR 0020](../adr/0020-changed-nodes-and-board-hash.md)).
  In Standalone the publisher of #204 already derives after every write and every minute, so
  time-based events (Overdue, a generated occurrence, a lock lifting) arrive as events without a
  write. In Client mode the relayed events of the server's publisher are the same. No second
  derivation and no extra board load beyond the first one.
- **Rules.** The core's `arlesh_core::push::rules`. A `BoardView` keeps the few fields the rules
  read (Task title, generated, done; Overdue and archival; open question; capacity blocks), is
  built from the first board and kept true by each event's changed nodes, and reads its facts with
  the same function the server's `observe` uses. `rules::desktop::DesktopNotifier` then runs
  `plan` against the device's own told-record. The lock is read off the board: a node carrying the
  derived `agent_capacity` block. (The server reads it off its agents; the two differ only for a
  locked agent with no open Agentic Task in its Claim, which the board shows no sign of.)
- **Told-already record.** Kept in memory in the one process, so a restart forgets it. The first
  board after startup counts as already told, as a new phone does: nothing is announced for what
  was true before. A fact is recorded when it is planned, whether or not it is shown (a switched-off
  event, an own action), and forgotten when it stops holding, so holding again is news. A board
  reload after a gap or a new run of the server is read like an event: what is new on it is told.
- **Own actions.** The user's own writes on this device do not notify what they made true: a
  window that settles on a write asks `board_fence`, which notes the revision; the first
  publication holding it does not notify Overdue or generated Tasks. An agent's question and the
  capacity lock always notify, since the user cannot cause them. (A fence the window asks for after
  the publication has already arrived is not seen, and that notification is shown.)
- **Switches.** Linux has no per-channel system toggle, so Settings → Notifications has one switch
  per event, defaulting to on, in `notifications.json` in the app's data directory (the phone's are
  Android's system channels; the server stores none). They are per device and never travel with the
  board.
- **Words.** The phone's (`push_strings.xml`), in English, titled *Arlesh*. Delivery is Tauri's
  notification plugin, desktop builds only.
- **Click.** Only a notification of an agent's question reacts to a click, and only on Linux: the
  plugin reports no click on the desktop (its action callbacks are mobile only), so there the app
  speaks to the freedesktop notification service directly (`notify-rust`, which the plugin wraps).
  The notification carries the service's `default` action, which a daemon runs when the
  notification itself is clicked, and a thread waits for it. What a click does is in
  [Opening the Review list](#opening-the-review-list). A daemon that does not offer actions shows
  the notification and never reports a click. On macOS and Windows the plugin still shows the
  notification and a click does nothing (no path reports it); the other four events do nothing on
  a click anywhere.

## Opening the Review list

Settled with the user on 2026-11-21: a notification of an agent's question or review opens the List
View on the Review preset ([List View](list-view.md)), with the Task that holds the question
selected and scrolled into view. (The list draws a question on its Task, so the Task's row is the
selection.)

- **Desktop.** A click raises and focuses the app's window (first window; shown again if it is in
  the tray) and shows a **List tab on the Review preset**: a new tab after the active one, unless a
  List tab on the Review preset over the whole board is already open, in which case that tab is
  switched to. The tab is an ordinary tab and is written down with the strip.
- **Phone.** A tap replaces the active tab's view with the List View on the Review preset, over the
  whole board (it leaves a subtree it was in). There is no history to restore: Back does not return
  to the previous view. It works with the app running and from a cold start.
- **Gone already.** A question answered or released by the time the notification is opened is no
  longer in the Review list: the list still opens, with nothing selected, and no error.
