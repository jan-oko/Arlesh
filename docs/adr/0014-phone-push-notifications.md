# The server pushes open agent questions to the phone through FCM, as pointer-sized data messages

The user asked for notifications on the phone, so that an agent waiting on them is noticed with the
app closed. Today Arlesh has none at all: no notification plugin, no `POST_NOTIFICATIONS`
permission, no FCM client and no sender. The design was settled with the user on 2026-11-04 (the
decided points are listed under *Context*). The behaviour is specified in
[Notifications](../spec/notifications.md). This ADR records how it is built and why, and lists the
product questions it leaves for the user.

ADR 0013 (branch `mcp-channels`, in flight) designs the sibling feature: **agent** notifications,
telling an agent that the user answered. This ADR is the other direction, telling the **user** that
an agent asked. The two share a trigger: a wait changing state. *Shared touchpoints with ADR 0013*
below says where they meet.

## Status

proposed (2026-11-04). Not built. Decisions 1–4 follow what the user settled. The rest are this
design's, and the product questions are under *Open questions*: nothing that depends on one is final
until the user answers it.

## Context

Decided with the user on 2026-11-04:

- **Push goes through FCM**, so it reaches a phone whose app is in the background or closed.
- **Credentials.** The release app's `google-services.json` lives in a **repository secret**, and
  `bundles.yml` writes it before the Android build. The server reads a **service-account JSON from a
  path** at runtime, and push is **off when that is unset**. Nothing is committed.
- **Box builds** (`com.atai.arlesh.box.<branch>`) keep their per-branch Firebase apps and must
  receive push too.
- **Reuse ADR 0013's wait events** as the trigger where that makes sense, rather than building a
  second change feed.

What exists:

- The phone is the Client-mode app ([Client Mode](../spec/client-mode.md), *Android*). It drops its
  change stream when suspended, so today it learns nothing in the background.
- A device pairs by PIN and holds its own bearer token. Its **client name** is its identity in
  `server_tokens`, in the undo journal, and in Settings → Devices.
- `arlesh-server` (FastAPI, `crates/arlesh-py/python/arlesh/server/`) bumps one **revision** per
  committed write, from any route, any client, or an agent through `/mcp`, and exposes
  `database.next_change(revision)` in-process. `/events` is built on it.
- `scripts/box.py` already registers a Firebase Android app per box branch in
  `ARLESH_BOX_FIREBASE_PROJECT` and writes a gitignored `google-services.json`. The Gradle build does
  not apply the google-services plugin, so the file is never read. `bundles.yml`'s box path builds
  in CI with no Firebase file at all.
- The thing on the board that most needs the user is an **open agentic question**: a pending, live
  agentic wait with `question: true`. It idles an agent, and it makes an On Agent Task read
  **Review** ([Resources](../spec/resources.md), *Agentic statuses*).

## Decisions

1. **FCM, sent by `arlesh-server`, to Android only.** The server is the only process that is always
   up and sees every write, the MCP's included. The desktop app sends nothing. *Why:* the phone
   cannot hold a connection in the background, and Android gives an app only one supported way to
   be woken from outside it: FCM. A desktop in Standalone has no phone, because the phone is
   Client-only.

2. **Credentials by path, off when absent, fatal when wrong.** `ARLESH_FCM_CREDENTIALS_FILE` names
   the service-account JSON. In the container image it is a mounted secret. When the variable is
   unset, push is `off`: the routes still work and registrations are kept, so turning push on later
   needs nothing from the phones. When it is set but the file cannot be read, is not a service
   account, or has no `project_id`, the server **refuses to start**, the way giving both
   `ARLESH_DATABASE_URL` and its `_FILE` is refused. *Why:* "off when unset" was the user's ruling.
   A secret that is mounted wrong should fail the deploy loudly, not run for weeks sending nothing.

3. **The release `google-services.json` comes from the secret `ANDROID_GOOGLE_SERVICES_JSON`.**
   `bundles.yml` writes it to `src-tauri/gen/android/app/` in a step before `tauri build`, on the
   release path only. *Why:* that is the user's ruling. Firebase documents this file as not secret
   (its API key identifies the project, and is in every APK), so the build step being able to read
   it is acceptable, unlike the signing keys, which stay confined to the signing step.

4. **Box builds bring their own file, and the plugin applies only when one is present.**
   `app/build.gradle.kts` applies `com.google.gms.google-services` if and only if
   `google-services.json` exists beside it. A build without it compiles and runs, with Firebase
   uninitialised, and the app reports "this build cannot receive push". Local box builds already
   write the file. For CI box builds, `box run --ci` makes the same file locally (it has the gcloud
   credentials) and passes it base64 as a new `bundles.yml` dispatch input, `google_services_b64`,
   which the box job writes after `ci-patch`. `box run` reuses a cached CI build only if its run had
   that input. A box server gets credentials from `ARLESH_BOX_FCM_CREDENTIALS_FILE`, which
   `box server start` passes on as `ARLESH_FCM_CREDENTIALS_FILE`, and which must be a service
   account of `ARLESH_BOX_FIREBASE_PROJECT`. *Why:* per-branch apps are created on demand, so no
   single repository secret can hold their configs. The input is safe because the file is not a
   secret (decision 3), and it keeps CI free of a Firebase admin credential, which the alternative
   (CI registering the app itself) would need. The conditional plugin keeps PRs, forks and
   `--no-firebase` builds green.

5. **What notifies, in the first version: each open agentic question.** One notification per
   question, cleared when it stops being open (answered, archived, deleted, or its Task deleted),
   shown again if it reopens. A wait that is not a question never notifies, and edits to an open
   question do not either. The device that raised a question is not notified of it. Overdue items
   and other categories are left out until the user asks for them (OQ 1). *Why:* a question is the
   one item that costs something every minute it waits, because an agent sits idle. Each one is
   something the user must do, so one notification each, removed when done, keeps the shade honest,
   as the board's Review section is. Notifying per **question** and not per **Task entering
   Review** gives the same set in practice, and also covers a question under a Task the user is
   Doing, which an agent may still need answered.

6. **Exactly-once by reconciling state, not by replaying events.** Two server-only tables are added
   in one migration (its number assigned at delivery): `push_registrations` (one row per device:
   client name, FCM token, app id, permission, settings, status, `registered_at`, `last_sent_at`)
   and `push_notified` (one row per device and question it has shown). Both reference
   `server_tokens` and are deleted with it. Neither is journaled. A pure planner takes the open
   questions and a device's `push_notified` rows and answers what to send: `question` for new ones,
   `dismiss` for rows no longer open, and a `summary` in place of more than three new ones. A row is
   written only once FCM accepts the message. A device that turns notifications on is seeded with the
   questions already open, without sending them. *Why:* this is the "read on connect" idea ADR 0013
   adopted for the agent mod, applied server-side. Nothing has to be delivered exactly once over a
   stream: after a restart, a lost connection to Google, or an undo, the next look sends what is
   missing and clears what is stale, and a duplicate cannot happen because the record is the dedup
   key. The summary keeps an orchestrator that fans out eight agents from producing eight alerts.

7. **The revision is the wake-up; ADR 0013's typed wait events replace it when they land.** A
   dispatcher task, started in the server's lifespan, waits on `database.next_change`, lets the
   board settle for two seconds, then reads the open questions once (a new binding over the core's
   wait and Review rules, with each question's `raised_by` client from the journal) and runs the
   planner for each registered device. When ADR 0013's producer of `/events/expectations` exists,
   the dispatcher subscribes to it **in-process** and wakes only for wait events. *Why:* the user
   asked to reuse 0013's events rather than invent a second feed, and this does: the dispatcher
   consumes the same producer, with no HTTP hop to itself. Because the events are only a wake-up
   and the truth is the reconciled state (decision 6), the dispatcher does not depend on 0013's
   event shape, and the two efforts can land in either order. The revision fallback costs one
   indexed read per settled burst of writes, which is cheap at one user's scale.

8. **The sender is a port with a real and a fake implementation.** `FcmSender` (a Protocol in
   `ports/fcm/`) has `send(token, message) -> Delivery`. `HttpV1FcmSender` posts to
   `https://fcm.googleapis.com/v1/projects/<project>/messages:send` with httpx, using an OAuth token
   minted by `google-auth` from the service account (scope
   `https://www.googleapis.com/auth/firebase.messaging`, refreshed before expiry, the blocking
   refresh run in a thread). `FakeFcmSender` records the messages and answers scripted verdicts.
   Delivery uses at most four concurrent requests. 429 and 5xx are retried with exponential backoff
   and jitter, honouring `Retry-After`, for up to an hour, and a retry is dropped if its question
   closed meanwhile. `UNREGISTERED` (or a 400 naming the token) deletes the registration.
   `SENDER_ID_MISMATCH` marks it `wrong_project`. A 401 or 403 on the server's own credentials sets
   the push state to `error`. There is **no batching endpoint**: FCM retired its batch send in 2024,
   and v1 sends one message per request. *Why:* the port is what makes the dispatcher testable
   without Google. The rest is FCM's documented error contract, mapped onto the three things the
   server can do: retry, forget the token, or report.

9. **Data messages only, carrying a pointer and only the text the device allows.** Every message
   is an FCM **data** message (no `notification` block). `question` is high priority, while `dismiss`
   is normal priority. The payload is `v`, `kind`, the wait and Task ids and short ids, and, only as
   the device's setting allows, `title` and `body` (the content levels Minimal, Title and Full are in
   the spec). *Why:* a notification message is drawn by the system when the app is in the
   background, which takes away the channel, the grouping, the dismissal by tag and the tap target.
   A data message is handed to the app's service in every state, and high priority is what reaches a
   phone in Doze. Google can read every payload in transit, so the device decides how much board text
   goes through it (OQ 3). The same principle, a message that is a pointer, is ADR 0013's for agents.

10. **Registration: the device's token owns the FCM token.** The phone sends
    `PUT /devices/current/push` (`fcm_token`, `app_id`, `permission`, `settings`) on every start and
    resume while notifications are on, if the token differs from the last one acknowledged, so
    token refresh needs no background network. `DELETE` unregisters it, and revoking the device
    deletes the row. The Rust `Backend` port gains a `PushBackend` trait. `HttpBackend` maps it to
    those routes (the REST parity test covers it), and `SqliteBackend` answers "not available in
    Standalone". *Why:* the client name is already the device's identity everywhere. Keying the FCM
    token by it means revoke, the Devices page, and the "do not notify the device that raised it"
    rule all come for free. Re-sending on start is how Firebase recommends handling `onNewToken`
    when the app cannot reach its server from the service.

11. **Opt-in, and Firebase stays dormant until then.** Notifications are off on a fresh install.
    The manifest sets `firebase_messaging_auto_init_enabled` to `false`, so no FCM token (and no
    Firebase Installation) exists until the user turns notifications on in Settings →
    Notifications. That switch is also the only place the app asks for `POST_NOTIFICATIONS`
    (Android 13+). Turning it off deletes the token on the phone and the registration on the server.
    *Why:* a device that never wants push never talks to Google, and the permission prompt appears
    when the user has just said yes, which is when Android's guidance says to ask.

12. **The Android side.** In `src-tauri/gen/android`:
    - `ArleshMessagingService` (`FirebaseMessagingService`, not exported) parses the payload with a
      pure `PushPayload` parser, and posts, replaces or cancels by tag (the wait id). `onNewToken`
      saves the token to the app's preferences for the next start.
    - Two channels, `agent-questions` (high) and `general` (default), created at startup and by
      the service.
    - `PushBridge` is the page's `window.ArleshPush`: `status()` (whether Firebase is configured,
      the permission, and the token), `requestPermission()`, `enable()`, `disable()`, and
      `takeLink()`. It follows `SystemBarsBridge`'s pattern and gets the same R8 keep rule. The
      Firebase libraries bring their own consumer rules, and the service is kept through the
      manifest.
    - **The tap** is an explicit `PendingIntent` (`FLAG_IMMUTABLE`) to `MainActivity` with the node
      in its extras. `MainActivity` is `singleTask`, so `onNewIntent` stores the link and tells the
      page with a DOM event (`arlesh-push-link`), and a cold start leaves it for `takeLink()`.
      There is no `arlesh://` intent filter. *Why:* an exported scheme would let any app drive the
      board's selection. An explicit, immutable intent can come only from Arlesh's own
      notifications.
    - **The page** handles a link with a hook: wait for the board, select the question's Task in the
      active tab under the focus exemption, and open the wait's editor at **Answer**. A link to a
      question that is gone shows a toast and the Task.
    - **Gradle:** the google-services plugin version in the root `build.gradle.kts`, applied
      conditionally (decision 4), and `firebase-messaging` through a pinned Firebase BoM. Nothing
      else from Firebase is added: no Analytics, no Crashlytics.

13. **Desktop is out of scope.** No Tauri notification plugin and no desktop path in this ADR.
    *Why:* the desktop is where the user already sees the board, and a Standalone desktop has no
    server to send from. Local notifications there are a separate feature (OQ 5).

## Shared touchpoints with ADR 0013

| Touchpoint | ADR 0013 | Here |
| --- | --- | --- |
| `/events` → `/events/changes` rename | Its PR renames the route, and the apps follow in the same PR | Not touched. The dispatcher uses the in-process revision, and the phone's foreground stream is unchanged. The spec says "`/events/changes` (today `/events`)" |
| `/events/expectations?agentic=true` producer | Builds it, for the agent mod | PR 6 subscribes the dispatcher to the producer in-process. **It needs a `raised` kind** (a wait appearing as pending), which 0013's mod does not need, since it sees raises through its hook. If 0013 lands without it, PR 6 adds it to the shared producer |
| Wait-event fields | Wait id, Task id, status, archived or deleted | PR 6 needs `question` and `agentic` on each event too, so it can filter without a read |
| `lifespan.py` | Starts the `/events/expectations` producer | PR 3 starts the dispatcher. Whichever lands second rebases onto the other's `closers` |
| `docs/spec/http-api.md` routes table | Adds `/events/changes` and `/events/expectations` | PR 2 adds `/push` and `/devices/current/push`. A plain text conflict |
| Migrations | None (the server keeps no history) | One migration, in PR 2 |
| The "pointer, not content" message | The agent's notification names the wait and says to read it | The phone's payload carries ids, plus only the text the device allows |

## Considered options

- **FCM notification messages** (system-drawn): less code, but no dismissal when answered
  elsewhere, no per-device redaction in the app, and a tap with no target. Rejected (decision 9).
- **A foreground service holding the SSE stream**: no Google in the path, but a permanent
  notification, battery cost, and Android 14's foreground-service type rules. It also cannot survive
  the app being swiped away on many OEM builds. Rejected. The user chose FCM.
- **UnifiedPush / ntfy**: no Google, but the user must install and run a distributor. It is worth
  revisiting if the privacy question (OQ 3) is answered "no board text through Google, ever".
- **Fetch-on-receive** (the payload holds only ids, and the phone fetches the text from the server
  when it arrives): it keeps all board text off Google with no loss of content, but it needs the
  server reachable at that moment (a tailnet away from home often is not), and a Kotlin HTTP path
  that the release build's cleartext policy blocks for a plain-HTTP server. Kept as a follow-up
  (OQ 3).
- **End-to-end-encrypted payloads** (the phone registers a public key, and the server encrypts each
  payload): full content with Google seeing only ciphertext. The cost is an Android Keystore key
  pair, ECDH and AES-GCM on both sides, and key rotation on reinstall. Kept as a follow-up (OQ 3).
- **Event replay with an outbox** in place of state reconciliation: it needs exactly-once delivery
  of events across restarts, which neither the revision nor 0013's stream offers (0013's server
  keeps no history). Rejected (decision 6).
- **CI registering box Firebase apps itself**: it needs a Firebase admin credential in the
  repository's secrets for a debug convenience. Rejected (decision 4).

## Consequences

- `arlesh-server` gains `google-auth` (with `requests`) in its `server` extra.
- The Android release build needs the secret `ANDROID_GOOGLE_SERVICES_JSON`. Without it the release
  APK builds but cannot receive push, and the bundles run warns.
- Google sees, for every device that turns notifications on: that device's FCM token, the timing
  of every question, and whatever text its content setting allows.
- No board concept is added or changed, so the model map is unchanged. Registrations are server
  infrastructure, like `server_tokens`.

## Delivery

Six pull requests to `dev`, each green on its own. PRs 2–3 (server) and 4–5 (Android) are two
independent stacks, and PR 6 waits for ADR 0013's producer. Every PR follows `AGENTS.md` and
`.claude/rules/`: `@/` imports, no `any`, no `as`, every new string through i18n (the
`translating-ui` skill), Rust tests in sibling files, and no `.unwrap()`. Each PR that changes
behaviour gets one changelog fragment. A migration number is asked of the orchestrator.

### PR 1: this ADR and the area file

Docs only: `docs/adr/0014-phone-push-notifications.md`, `docs/spec/notifications.md`, and the
`SPEC.md` index line.

### PR 2: registrations on the server

- **Scope.** The tables, the store, the routes, and revoke's cascade. Nothing is sent yet, and
  `GET /push` reads `off` or `on` from the configuration alone. The credentials setting is read and
  validated (decision 2).
- **Files.** New: `crates/arlesh-core/migrations/NNNN_push.sql` (`push_registrations` and
  `push_notified`, both `ON DELETE CASCADE` from `server_tokens`); the core operations and the
  Python bindings for them, beside the token store's; `server/ports/push/push_store.py` (Protocol)
  and `database_push_store.py`; `server/entrypoints/fastapi/routers/push.py`. Changed:
  `server/config.py` (`fcm_credentials_file`, with validation); `routers/devices.py` (`push` on each
  device); `app.py` (mount); `docs/spec/http-api.md` (routes table).
- **Acceptance.**
  - `PUT` then `GET /devices/current/push` round-trips, and a second `PUT` replaces the first.
  - `DELETE /devices/{name}` removes that device's registration and notified rows.
  - `GET /push` reads `off` with the variable unset, and `on` with the `project_id` with a valid
    file. A bad file makes `create_app` raise with a message naming the variable.
  - `GET /devices` shows `push`.
  - pytest coverage stays at or above the gate, and `ruff`, `mypy` and the baseline test pass.

### PR 3: the sender and the dispatcher

- **Scope.** The planner, the FCM port and its two implementations, the dispatcher in the lifespan,
  the core read of open questions, and the test route.
- **Files.** New: `server/business_logic/notifications.py` (the pure planner: open questions,
  notified rows and settings in; messages out); `server/ports/fcm/fcm_sender.py` (Protocol, message
  and verdict types), `http_v1_fcm_sender.py` and `fake_fcm_sender.py`;
  `server/business_logic/push_dispatcher.py` (wake, settle, read, plan, send, record). The core and
  binding for open questions with `raised_by`, next to the waits' operations. Changed: `lifespan.py`
  (start and stop the dispatcher); `routers/push.py` (`POST /devices/current/push/test`);
  `pyproject.toml` (`google-auth`).
- **Acceptance.**
  - Planner, as table tests: a new question gives a `question` for each device but the raiser; a
    closed one gives a `dismiss` to each device that has its row; more than three new gives one
    `summary`; Minimal, Title and Full each carry exactly the allowed fields; a reopened question
    is sent again.
  - Dispatcher with `FakeFcmSender` against a real test database: an ask by `mcp` reaches the fake
    once; the answer dismisses it; a restart between the two still dismisses; an undo within the
    settle window sends nothing.
  - `HttpV1FcmSender` with `httpx.MockTransport` on FCM's recorded error bodies: `UNREGISTERED`
    deletes, `SENDER_ID_MISMATCH` marks, 429 with `Retry-After` waits that long, 503 backs off, 401
    sets the state to `error`. The token is minted once and reused.
  - Nothing is sent while the state is `off`.

### PR 4: Android build plumbing

- **Scope.** Firebase can initialise in a build that has the file, and every build still compiles
  without it. No runtime behaviour yet.
- **Files.** `src-tauri/gen/android/build.gradle.kts` (the plugin's classpath and version);
  `app/build.gradle.kts` (the conditional `apply`, the Firebase BoM and `firebase-messaging`);
  `AndroidManifest.xml` (`POST_NOTIFICATIONS`, and `firebase_messaging_auto_init_enabled=false`);
  `proguard-rules.pro` (the `PushBridge` keep rule, ready for PR 5); `.github/workflows/bundles.yml`
  (write `ANDROID_GOOGLE_SERVICES_JSON` on the release path with a warning when it is missing, and
  the `google_services_b64` input on the box path); `scripts/box.py` (drop the "plugin not applied"
  note; pass the input on `--ci`; reuse only matching runs; pass `ARLESH_BOX_FCM_CREDENTIALS_FILE`
  on `server start`), and its unittest; `docs/spec/client-mode.md` (*Trying it*: the new variable
  and input).
- **Acceptance.** A `bundles.yml` dispatch builds the release APK with the secret, and a box
  dispatch builds with and without the input, all green. box.py's unittest covers the reuse rule and
  the environment pass-through.

### PR 5: Android runtime and the app

- **Scope.** The service, the channels, the bridge, the permission, the deep link, the Rust
  `PushBackend`, and Settings → Notifications. It may be split in two at the bridge: the Kotlin side,
  then the TypeScript and Rust side.
- **Files.** New Kotlin: `ArleshMessagingService.kt`, `PushPayload.kt` (a pure parser, with JUnit
  tests), `PushBridge.kt`, `PushChannels.kt`. Changed: `MainActivity.kt` (`onNewIntent`, the
  bridge); `AndroidManifest.xml` (the service). Rust: a `PushBackend` trait in the port,
  `HttpBackend` and `SqliteBackend` implementations, and thin commands. Frontend: `src/api/push.ts`;
  `src/hooks/use-push-registration.ts` (start and resume registration);
  `src/hooks/use-push-link.ts` (the deep link); a Settings → Notifications section and its CSS
  Module; i18n keys; the bell on Settings → Devices.
- **Acceptance.**
  - The REST parity test covers the new methods.
  - Hook tests (with a fake `window.ArleshPush`): registration is sent when the token changed and
    not otherwise; turning off calls `DELETE` and `disable()`; a link selects the Task and opens the
    editor at Answer; a gone question shows the toast.
  - Component tests for each blocked state in the table in the spec.
  - The `PushPayload` JUnit tests run in the bundles Android job (`testReleaseUnitTest` before the
    build).
  - **By hand on a phone** (in the PR's checklist): grant and deny the permission; ask from an
    agent with the app closed; answer on the desktop and see the notification go away; tap from a
    cold start and from the background; a box build on a box server.

### PR 6: wake on ADR 0013's wait events (after 0013's producer lands)

- **Scope.** The dispatcher subscribes in-process to the `/events/expectations` producer, filtered
  to agentic questions, and keeps the revision path only as a periodic safety reconcile (every
  five minutes). It adds the `raised` kind, and the `question` and `agentic` fields, to the producer
  if 0013 did not.
- **Files.** `push_dispatcher.py`; the shared producer module, coordinated with 0013's owner.
- **Acceptance.** The PR 3 dispatcher tests pass unchanged on the new wake-up, and a burst of
  unrelated writes causes no read of the open questions.

## Open questions

1. **What else notifies?** Overdue items (a Task or wait whose window lapsed), Commitments coming
   due, a check falling due, non-question waits that the user chose to watch? Each needs a category
   switch, and the time-based ones need a timer on the server, since no write triggers them. The
   first version does agent questions only.
2. **Per question, or per Task entering Review?** This design notifies each open question (decision
   5). The alternative is one notification per Task when it starts to read Review.
3. **What may pass through Google?** The default content level (Minimal, Title or Full), and
   whether Full should exist at all. A stronger answer is one of the follow-ups: fetch-on-receive,
   or end-to-end-encrypted payloads.
4. **Quiet hours on the server?** This design leaves them to Android's Do Not Disturb and the
   channel settings. The server could instead hold notifications in a window per device, and send a
   summary when it ends.
5. **Desktop notifications?** Out of scope here. Should a desktop app (Standalone or Client) raise
   local notifications for the same events through Tauri's notification plugin, as a separate
   feature?
6. **Answer from the notification?** An inline reply (Android `RemoteInput`) would release the
   question without opening the app. It needs a write from the service with the device's token, a
   path for when the server is unreachable, and the Answer rule's refusals shown in a notification.
7. **The permission prompt's timing.** This design asks only from Settings. Should the app also
   offer it once, for example the first time a question appears on the board while the app is open?
