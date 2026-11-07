# Notifications

*One area of the [Arlesh design specification](../../SPEC.md).*

Arlesh tells the user's phone when something on the board needs them, through **Firebase Cloud
Messaging** (FCM), so a notification arrives with the app in the background or closed.
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

Each notification of a Task carries the Task's title. Tapping it opens the Task in the app.

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
- **The tap** opens the app at the Task the notification names, selecting it in the active tab. The
  intent is explicit to Arlesh's own activity; there is no link another app could send.
