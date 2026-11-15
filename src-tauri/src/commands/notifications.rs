//! Tauri's side of desktop notifications: the system's notification service as the deliverer, the
//! tap on the change events every window is already told, and the two commands the settings page
//! calls. The decisions are [`crate::notifications`] and the core's rules; nothing here decides.

use std::{path::Path, sync::Arc, time::Duration};

use arlesh_core::push::model::Channel;
use tauri::{Manager, Runtime, State};

use crate::{
    backend::{revision::BoardChange, AppBackend},
    error::WireError,
    notifications::{Deliver, Followed, Notice, Notifications, Switch},
};

/// How long to wait before asking again for a board that could not be had.
const RETRY: Duration = Duration::from_secs(10);

/// Shows notices through Tauri's notification plugin.
#[cfg(desktop)]
struct SystemNotices<R: Runtime>(tauri::AppHandle<R>);

#[cfg(desktop)]
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
