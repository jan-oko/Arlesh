# Notifications

*One area of the [Arlesh design specification](../../SPEC.md).*

Arlesh tells the user's phone when something on the board needs them, through **Firebase Cloud
Messaging** (FCM), so a notification arrives with the app in the background or closed. `arlesh-server`
sends it. The phone runs only in Client mode ([Client Mode](client-mode.md), *Android*), so push
needs a server: a desktop app in Standalone mode has no phone to notify. Designed with the user on
2026-11-04. The decisions and the reasons for them are in
[ADR 0014](../adr/0014-phone-push-notifications.md). Nothing here is built yet. Points marked
*(open)* wait on a question listed in the ADR.

## What notifies

**An open agentic question.** A question wait is a pending, live agentic wait with `question: true`
(see [Resources](resources.md), *Expectations*). It is the one thing on the board that idles an agent
until the user answers, and it is what makes an On Agent Task read **Review**. Each one gets **its
own notification**, titled with its Task. A question raised by the device itself is not pushed to
that device: a device is not told what it just did.

**When a question stops being open, its notification goes away.** Answering it, archiving it,
or deleting it or its Task all clear it, from the phone and from every other device that showed
it. The device that answered it is cleared too. A question
that opens again (an undo of its release, or a release taken back by hand) is notified again.

**Not notified:** a wait that is not a question (CI and the like ask nothing of the user), and edits
to a question that is still open (its title or note). Overdue items, Commitments due, and other
categories are not in the first version *(open)*.

## Per-device settings

Each device keeps its own settings **on the server**, beside its registration, because the server
decides what to send. Nothing switched off ever passes through Google.

- **Notifications**: on or off for this device. Off by default. Turning it on is the only thing that
  asks Android for permission and the only thing that gets an FCM token, so a device that never turns
  it on never contacts Firebase.
- **Agent questions**: on or off (on, once notifications are on). Later categories appear here as
  they are built.
- **What a notification shows** *(open: the default)*:
  - **Minimal**: "An agent is waiting for your answer". No board text leaves the server.
  - **Title**: the Task's title, with "An agent is waiting for your answer" below it.
  - **Full**: the Task's title and the question itself.
- **Send a test notification**: sends one through the whole path and reports what happened.

Android's own controls stay in charge of sound, vibration, Do Not Disturb and each channel's
importance. The page links to the app's system notification settings. The server has no quiet hours
*(open)*.

**Settings → Notifications** is the page. It is shown in Client mode on Android. On a build or a
server that cannot push, it says why and offers nothing to switch:

| State | Shown |
| --- | --- |
| The server has no FCM credentials | "Push is off on the server" |
| This build has no Firebase configuration | "This build cannot receive push notifications" |
| Android permission denied | "Notifications are blocked for Arlesh", with a link to the system settings |
| The server's project does not match this app | "This server sends from a different Firebase project" |
| Working | the switches, and when the last notification was sent |

**Settings → Devices** shows a bell beside each device registered for push, so the user can see
which devices will be notified.

## Registration

The phone registers its **FCM token** against its **device token**: the server stores the FCM token
under the device's client name, so a phone needs no identity beyond the one pairing gave it.

- **When.** On each start and resume, while notifications are on, the app reads its current FCM
  token and sends it if it differs from the one the server last acknowledged. FCM rotates tokens
  rarely, and a rotation is picked up on the next start. A token rotated while the app is closed is
  kept by the service and sent on the next start.
- **What.** `PUT /devices/current/push` with the FCM token, the app's package (`com.atai.arlesh`, or
  a box build's `com.atai.arlesh.box.<branch>`), whether Android lets the app post notifications,
  and the settings. The answer is the stored registration and the server's push state.
- **Turning notifications off** calls `DELETE /devices/current/push` and deletes the FCM token on
  the phone (`FirebaseMessaging.deleteToken`).
- **Several devices.** Each device holds one registration, keyed by its client name. Two phones are
  two devices, each with its own settings. A box build and the release app on one phone are two
  devices.
- **Revoking a device** (Settings → Devices, or `arlesh-server token revoke`) deletes its
  registration and its record of what was sent, in the same transaction. A revoked phone gets
  nothing more.
- **A token FCM rejects** as unregistered is deleted at once. The phone registers again on its next
  start if notifications are still on.
- **The desktop app** never registers.

## What is sent

Every message is a **data message**: the app's own service builds the notification, so it controls
the channel, the text, the tap and the dismissal. Messages carry ids, a kind, and only the text the
device's setting allows:

| Field | Meaning |
| --- | --- |
| `v` | The payload version, `1` |
| `kind` | `question` (show), `dismiss` (remove), `summary` (several at once), `test` |
| `wait`, `task` | The question's wait id and Task id, and their short ids |
| `title`, `body` | Present only as **Title** or **Full** allows |
| `count` | For `summary`: how many questions are open for this device |

A notification's **tag** is its wait id, so a second message for the same question replaces the
first, and `dismiss` removes it. A `question` is sent at **high** priority, which is what lets it
reach a phone in Doze. A `dismiss` is sent at normal priority, since it shows nothing.

**Bursts.** The server waits until the board has been quiet for two seconds before it looks, so an
answer and its undo, or an agent's ask straight after a release, cost nothing. When one look finds
more than three new questions for a device, it sends one `summary` ("4 questions are waiting for
you") in place of four notifications. A device that turns notifications on is not sent the
questions already open then; it starts from the next one.

## On the phone

- **The permission.** On Android 13 and later, turning notifications on in Settings asks for
  `POST_NOTIFICATIONS`. Arlesh never asks on its own at startup. A refusal leaves the switch off and
  shows the blocked state. Older Android needs no prompt.
- **Channels.** `agent-questions` ("Agent questions", high importance: sound and heads-up) and
  `general` ("Other", default importance: the summary, the test, and later categories). The user
  changes their sound and importance in Android's settings.
- **The notification.** Arlesh's monochrome mark as its small icon, the accent colour, the
  question's text as allowed, grouped under one group per channel so several questions collapse
  into one stack. Tapping it removes it.
- **The tap** opens the app at the question: the active tab selects the question's Task (shown
  under the focus exemption if the preset would hide it) and opens the wait's editor with the
  **Answer** field focused. A `summary` opens the List View under the **Start** preset, where Review
  leads. If the question is no longer open, the app says "That question has already been answered or
  removed" and shows its Task. The app reaches the board first, so a tap while the server is
  unreachable shows the offline board with that toast.
- **Links are internal.** The tap is an explicit, immutable intent to Arlesh's own activity, holding
  the node in its extras. There is no `arlesh://` link another app could send.
- **Without Firebase.** A build with no `google-services.json` builds and runs. It just cannot
  register, and says so.

## Box builds

A box build (`npm run box`, see [Client Mode](client-mode.md), *Trying it*) receives push like the
release app, as its own Firebase app:

- **Local builds.** With `ARLESH_BOX_FIREBASE_PROJECT` set, `box run` registers
  `com.atai.arlesh.box.<branch>` in that project and writes its `google-services.json`. The Gradle
  build applies the google-services plugin whenever that file is present.
- **CI builds.** `box run --ci` makes or fetches the same file locally and hands it to `bundles.yml`
  as a dispatch input (`google_services_b64`). The box job writes it before building. A CI run
  without it builds an APK that cannot receive push, and `box run` reuses a cached CI build only if
  it was built with the file.
- **Box servers.** `box server start` passes `ARLESH_BOX_FCM_CREDENTIALS_FILE` to the server it
  starts as `ARLESH_FCM_CREDENTIALS_FILE`. That service account must belong to
  `ARLESH_BOX_FIREBASE_PROJECT`: FCM only delivers to tokens of the sender's own project.

## The server

- **Turning it on.** `ARLESH_FCM_CREDENTIALS_FILE` names a Firebase **service-account JSON** file
  (in the container image, a mounted secret such as `/run/secrets/arlesh-fcm.json`). Unset, push is
  **off**: registrations are still accepted and kept, nothing is sent, and the state reads `off`. Set
  but unreadable, not a service account, or without a `project_id`, the server **refuses to start**
  and says why. Nothing about Firebase is in the repository.
- **Sending.** FCM HTTP v1 (`POST /v1/projects/<project>/messages:send`), one request per device per
  message, with an OAuth access token minted from the service account (scope
  `firebase.messaging`) and refreshed before it expires. At most four requests are in flight.
- **Retries.** A 429 or a 5xx (`UNAVAILABLE`, `INTERNAL`, `QUOTA_EXCEEDED`) is retried with
  exponential backoff and jitter, honouring `Retry-After`, for up to an hour. A question answered
  meanwhile is not sent late; its retry is dropped.
- **Errors that end a registration.** `UNREGISTERED`, or a 400 naming the token, deletes it.
  `SENDER_ID_MISMATCH` keeps it, marked `wrong_project`, and sends nothing to it until it registers
  again. A 401 or 403 for the server's own credentials turns the state to `error` and logs it once.
- **Exactly once, by state.** The server keeps, per device, the questions it has notified. Each look
  compares the open questions with that record: new ones are sent and recorded once FCM accepts them,
  and recorded ones no longer open are dismissed and forgotten. A restart loses nothing: the first
  look after it sends what was missed and dismisses what was answered meanwhile.
- **What wakes it** is the board's revision, the counter `/events/changes` (today `/events`) is
  built on. Once ADR 0013's typed wait events exist, it listens to those in-process instead.

### Routes

| Path | What |
| --- | --- |
| `GET /push` | The server's push state: `off`, `on` or `error`, and the Firebase `project_id` when on |
| `GET /devices/current/push` | The asking device's registration: settings, `permission`, `status` (`ok` or `wrong_project`), `last_sent_at`; 404 `not_registered` without one |
| `PUT /devices/current/push` | Register or update: `fcm_token`, `app_id`, `permission`, `settings` |
| `PATCH /devices/current/push` | Change the settings alone |
| `DELETE /devices/current/push` | Unregister |
| `POST /devices/current/push/test` | Send a `test` message now; answers FCM's verdict |

`GET /devices` gains `push: true|false` per device. The tables are server-only, like
`server_tokens`: not read by the desktop app and not journaled.

## Desktop

Out of scope. A desktop in Client mode has the board open, and Standalone has no server to send
from. Local desktop notifications through Tauri's notification plugin are a separate decision
*(open)*.
