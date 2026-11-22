//! Tauri's side of desktop notifications: the system's notification service as the deliverer, the
//! tap on the change events every window is already told, and the two commands the settings page
//! calls. The decisions are [`crate::notifications`] and the core's rules; nothing here decides.

use std::{path::Path, sync::Arc, time::Duration};

use arlesh_core::push::model::Channel;
use tauri::{Emitter, Manager, Runtime, State};

use crate::{
    backend::{revision::BoardChange, AppBackend},
    error::WireError,
    notifications::{Deliver, Followed, Notice, Notifications, Switch},
};

/// How long to wait before asking again for a board that could not be had.
const RETRY: Duration = Duration::from_secs(10);

/// The event a click on an agent's question raises for the page: `{"task": "task-12", "wait": "<id>"}`. The page
/// shows a List tab on the Review preset with that Task selected (`src/api/notifications.ts`).
#[cfg(desktop)]
const OPEN_REVIEW_EVENT: &str = "arlesh-open-review";

/// What [`OPEN_REVIEW_EVENT`] carries.
#[cfg(desktop)]
#[derive(Clone, serde::Serialize)]
struct OpenReview {
    task: String,
    wait: Option<String>,
}

/// Raises the app's window and tells its page to show the Review list at `task`, focusing `wait`'s box. The first
/// window is the one that answers (a notification belongs to the app, not to a window), so several
/// windows never open the tab twice; a window hidden in the tray is shown.
#[cfg(desktop)]
fn open_review<R: Runtime>(app: &tauri::AppHandle<R>, task: &str, wait: Option<&str>) {
    let windows = app.webview_windows();
    let window = windows
        .get(crate::windows::BOOTSTRAP_LABEL)
        .or_else(|| windows.values().next());
    let Some(window) = window else {
        tracing::warn!("a notification was clicked with no window to show");
        return;
    };
    if let Err(error) = super::tray::show_window(window) {
        tracing::warn!(error = %error, "could not raise the window for a clicked notification");
    }
    let payload = OpenReview {
        task: task.to_owned(),
        wait: wait.map(str::to_owned),
    };
    if let Err(error) = window.emit(OPEN_REVIEW_EVENT, payload) {
        tracing::warn!(error = %error, "could not tell the window to open the Review list");
    }
}

/// Shows notices through Tauri's notification plugin: no click is reported through it on the
/// desktop, so a notice shown this way opens nothing (macOS and Windows).
#[cfg(all(desktop, not(target_os = "linux")))]
struct SystemNotices<R: Runtime>(tauri::AppHandle<R>);

#[cfg(all(desktop, not(target_os = "linux")))]
impl<R: Runtime> Deliver for SystemNotices<R> {
    fn show(&self, notice: &Notice) {
        use tauri_plugin_notification::NotificationExt;
        if let Err(error) = self
            .0
            .notification()
            .builder()
            .title(&notice.title)
            .body(&notice.text)
            .show()
        {
            tracing::warn!(error = %error, channel = notice.channel.as_str(), "could not show a notification");
        }
    }
}

/// The freedesktop notification action a daemon runs on a click on the notification itself.
#[cfg(target_os = "linux")]
const DEFAULT_ACTION: &str = "default";

/// Shows notices over the freedesktop notification service directly (`notify-rust`, which the
/// plugin wraps) because the plugin cannot report a click and the service can: a notice that opens
/// something carries the `default` action, and a thread waits for the daemon to say it was invoked.
/// A daemon that offers no actions shows the notice and never reports a click.
#[cfg(target_os = "linux")]
struct SystemNotices<R: Runtime>(tauri::AppHandle<R>);

#[cfg(target_os = "linux")]
impl<R: Runtime> Deliver for SystemNotices<R> {
    fn show(&self, notice: &Notice) {
        let target = notice
            .review_target()
            .map(|target| (target.task.to_owned(), target.wait.map(str::to_owned)));
        let mut shown = notify_rust::Notification::new();
        shown
            .appname(&notice.title)
            .summary(&notice.title)
            .body(&notice.text)
            .icon(&self.0.config().identifier);
        if target.is_some() {
            shown.action(DEFAULT_ACTION, "Open");
        }
        let handle = match shown.show() {
            Ok(handle) => handle,
            Err(error) => {
                tracing::warn!(error = %error, channel = notice.channel.as_str(), "could not show a notification");
                return;
            }
        };
        let Some((task, wait)) = target else {
            return;
        };
        let app = self.0.clone();
        // Blocks until the notification is closed or clicked, so it gets a thread of its own.
        std::thread::spawn(move || {
            handle.wait_for_action(|action| {
                if action == DEFAULT_ACTION {
                    open_review(&app, &task, wait.as_deref());
                }
            });
        });
    }
}

/// Starts the notification service: managed for the windows' commands, and loading the first board
/// (which counts as told) as soon as the backend can give one. Desktop only; a phone is told by
/// FCM.
#[cfg(desktop)]
pub fn install<R: Runtime>(app: &tauri::AppHandle<R>, app_dir: &Path) {
    let service = Arc::new(Notifications::new(
        app_dir,
        Arc::new(SystemNotices(app.clone())),
    ));
    app.manage(service);
    load_board(app.clone(), true);
}

/// Tells the service of a change event. Called wherever a window is told of one, once, so several
/// windows never show one notification twice.
pub fn follow<R: Runtime>(app: &tauri::AppHandle<R>, change: &BoardChange) {
    let Some(service) = app.try_state::<Arc<Notifications>>() else {
        return;
    };
    if service.on_change(change) == Followed::NeedsBoard {
        load_board(app.clone(), false);
    }
}

/// Fetches the latest publication for the service. At startup it asks again until the backend
/// answers (a server that is not up yet); after a gap it asks once.
fn load_board<R: Runtime>(app: tauri::AppHandle<R>, until_answered: bool) {
    tauri::async_runtime::spawn(async move {
        let Some(service) = app.try_state::<Arc<Notifications>>() else {
            return;
        };
        if !service.begin_load() {
            return;
        }
        loop {
            let backend = app.try_state::<AppBackend>();
            let board = match backend {
                Some(backend) => backend.current_board().await,
                None => Err(WireError::internal("the backend is not up yet")),
            };
            match board {
                Ok(board) => {
                    service.load(&board);
                    break;
                }
                Err(error) if until_answered => {
                    tracing::debug!(error = ?error, "no board for notifications yet");
                    tokio::time::sleep(RETRY).await;
                }
                Err(error) => {
                    tracing::warn!(error = ?error, "could not load the board for notifications");
                    break;
                }
            }
        }
        service.end_load();
    });
}

/// Every notification event and whether this device shows it.
#[tauri::command]
pub fn notification_switches<R: Runtime>(app: tauri::AppHandle<R>) -> Vec<Switch> {
    app.try_state::<Arc<Notifications>>()
        .map(|service| service.switches())
        .unwrap_or_default()
}

/// Switches one event on or off for this device.
#[tauri::command]
pub fn set_notification_enabled(
    service: State<'_, Arc<Notifications>>,
    channel: Channel,
    enabled: bool,
) -> Result<(), WireError> {
    service
        .set_enabled(channel, enabled)
        .map_err(|error| WireError::internal(format!("could not save the switch: {error}")))
}
