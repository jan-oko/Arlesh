//! Tauri's side of the window session: creating windows, reading their geometry, writing it down.
//!
//! The decisions this file serves are [`crate::windows`], which is pure and tested. Everything
//! here is adapter — it turns a saved [`WindowRecord`](crate::windows::WindowRecord) into a real
//! window, and a real window back into a record.
//!
//! # Every window is built the same way
//!
//! `tauri.conf.json` marks its window `"create": false`, so Tauri opens nothing at startup and
//! [`restore`] opens every window itself from that same config as a template. That is what makes
//! "every window is a tab strip" true at the bottom as well as the top: there is no window that
//! came into being differently from the others, and a restored session gets its windows back under
//! the **labels it saved**, which is what the frontend keys each window's tabs by.
//!
//! # Geometry
//!
//! Saved as the outer position and the inner size, in physical pixels, and restored by placing the
//! window after it is built rather than through the builder — the builder's position is in logical
//! pixels, and a session saved on one scale factor and replayed through logical coordinates lands
//! somewhere else. Windows are built hidden and shown once placed, so restoring never shows a
//! window jumping from the default spot to its own.

use tauri::{AppHandle, Manager, Runtime, WebviewWindow, WebviewWindowBuilder};

use std::collections::HashMap;
use std::sync::Mutex;

use crate::{
    commands::header_bar,
    error::WireError,
    icon,
    windows::{self, ListedWindow, OpenWindow, Placement, WindowRecord, WindowRect, WindowSession},
};

/// What each open window is called, by label: the number it wears and its active tab's name.
///
/// Managed state, seeded from the restored session and extended as windows are opened. It is the
/// live answer; [`WindowRecord::ordinal`] is how the number survives a restart. A map rather than
/// a field on the window because Tauri's window carries no room for one, and deriving either back
/// out of the title would make the title the source of truth for what composes it.
///
/// The tab is held here, not only sent once to the window, because a window's title depends on
/// how many **other** windows are open: opening or closing one retitles every window, and only
/// the frontend knows a tab's name — so the last name it reported is kept to compose with.
#[derive(Debug, Default)]
pub struct WindowNames(Mutex<HashMap<String, WindowName>>);

/// One window's entry in [`WindowNames`].
#[derive(Debug, Clone)]
struct WindowName {
    ordinal: u32,
    tab: String,
}

/// A window nothing has been recorded for yet wears 1 and has no tab — a runtime with one window,
/// or a tab reported before its window's number was.
impl Default for WindowName {
    fn default() -> Self {
        Self {
            ordinal: 1,
            tab: String::new(),
        }
    }
}

impl WindowNames {
    /// Records `label`'s number, for a window that has just been built.
    fn set_ordinal(&self, label: &str, ordinal: u32) {
        if let Ok(mut map) = self.0.lock() {
            map.entry(label.to_string()).or_default().ordinal = ordinal;
        }
    }

    /// Records the name of `label`'s active tab.
    fn set_tab(&self, label: &str, tab: &str) {
        if let Ok(mut map) = self.0.lock() {
            map.entry(label.to_string()).or_default().tab = tab.to_string();
        }
    }

    /// `label`'s number and tab, or [`WindowName::default`] for a window nothing recorded.
    fn get(&self, label: &str) -> WindowName {
        self.0
            .lock()
            .ok()
            .and_then(|map| map.get(label).cloned())
            .unwrap_or_default()
    }

    /// Every number an open window is wearing, which a new window's must not repeat.
    fn in_use(&self) -> Vec<u32> {
        self.0
            .lock()
            .map(|map| map.values().map(|name| name.ordinal).collect())
            .unwrap_or_default()
    }

    /// Frees `label`'s number, for a window that has closed for good.
    pub fn forget(&self, label: &str) {
        if let Ok(mut map) = self.0.lock() {
            map.remove(label);
        }
    }
}

/// `label`'s number and tab from `app`'s registry, or the default for a runtime that has none — a
/// test host, and one window.
fn name_of<R: Runtime>(app: &AppHandle<R>, label: &str) -> WindowName {
    app.try_state::<WindowNames>()
        .map(|names| names.get(label))
        .unwrap_or_default()
}

/// `label`'s number. See [`name_of`].
fn ordinal_of<R: Runtime>(app: &AppHandle<R>, label: &str) -> u32 {
    name_of(app, label).ordinal
}

/// How far a torn-off window is offset from the window it was torn out of, in physical pixels.
///
/// A new window landing exactly on top of its parent looks like nothing happened, which is the
/// worst outcome for a gesture whose whole point is seeing two things at once.
const TEAR_OFF_OFFSET: i32 = 48;

/// The file the session is written to, inside Tauri's app data directory.
const SESSION_FILE: &str = "windows.json";

/// The saved window session, and where it lives.
///
/// Managed state, because the save rule needs to know what was saved last: the windows of a
/// quitting app are destroyed one at a time and the final destruction reports none open, which
/// must not be written down. See [`windows::session_to_save`].
pub struct SessionStore {
    path: std::path::PathBuf,
    last: std::sync::Mutex<WindowSession>,
}

impl SessionStore {
    /// Reads the session that was saved under `app_dir`, or the bootstrap one if there is none.
    pub fn open(app_dir: &std::path::Path) -> Self {
        let path = app_dir.join(SESSION_FILE);
        let last = windows::read_session(&path);
        Self {
            path,
            last: std::sync::Mutex::new(last),
        }
    }

    /// The session as it stands, which is what [`restore`] reopens.
    pub fn session(&self) -> WindowSession {
        self.last
            .lock()
            .map(|session| session.clone())
            .unwrap_or_else(|poisoned| poisoned.into_inner().clone())
    }

    /// Writes `open` down, unless it is empty — see [`windows::session_to_save`].
    fn save(&self, open: Vec<WindowRecord>) {
        let mut last = match self.last.lock() {
            Ok(last) => last,
            Err(poisoned) => poisoned.into_inner(),
        };
        let next = windows::session_to_save(open, &last);
        windows::write_session(&self.path, &next);
        *last = next;
    }
}

/// The window's rectangle as the session records one: outer position, inner size, physical pixels.
fn rect_of<R: Runtime>(window: &WebviewWindow<R>) -> Option<WindowRect> {
    let position = window.outer_position().ok()?;
    let size = window.inner_size().ok()?;
    Some(WindowRect {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

/// Every connected display's bounds, or an empty list when they cannot be read.
///
/// An empty list is "we could not ask", and [`windows::placement`] reads it that way.
fn displays<R: Runtime>(app: &AppHandle<R>) -> Vec<WindowRect> {
    app.available_monitors()
        .unwrap_or_default()
        .into_iter()
        .map(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            WindowRect {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
            }
        })
        .collect()
}

/// The labels of every window that is open, in the order Tauri holds them, oldest first.
///
/// Tauri's map is unordered, so the session's own order is what puts them back in the order they
/// were opened; a window the session has never heard of sorts after the ones it has.
fn open_labels<R: Runtime>(app: &AppHandle<R>, session: &WindowSession) -> Vec<String> {
    let live: std::collections::HashSet<String> = app.webview_windows().into_keys().collect();
    let mut labels: Vec<String> = session
        .windows
        .iter()
        .map(|window| window.label.clone())
        .filter(|label| live.contains(label))
        .collect();
    let mut rest: Vec<String> = live
        .into_iter()
        .filter(|label| !labels.contains(label))
        .collect();
    rest.sort();
    labels.append(&mut rest);
    labels
}

/// Writes down which windows are open and where, for the next launch.
///
/// Called whenever that could have changed: a window hidden to the tray, one closed for good, and
/// the moment before a quit. Reading geometry is cheap and these are all user gestures, so there
/// is nothing to debounce.
pub fn snapshot<R: Runtime>(app: &AppHandle<R>) {
    let Some(store) = app.try_state::<SessionStore>() else {
        return;
    };
    let session = store.session();
    let open = open_labels(app, &session)
        .into_iter()
        .filter_map(|label| {
            let window = app.get_webview_window(&label)?;
            let ordinal = ordinal_of(app, &label);
            Some(WindowRecord {
                label,
                rect: rect_of(&window),
                ordinal,
            })
        })
        .collect();
    store.save(open);
}

/// A window's icon: Tauri's bundled one where a bundle exists, else the embedded PNG.
///
/// Applied per window rather than once to "the main one", because every window is the same thing —
/// and a `cargo run` build, which has no bundle, would otherwise leave every one of them bare.
fn app_icon<R: Runtime>(app: &AppHandle<R>) -> anyhow::Result<tauri::image::Image<'static>> {
    match app.default_window_icon().cloned() {
        // `to_owned` is what lifts a borrowed bundle icon out of the app it came from.
        Some(icon) => Ok(icon.to_owned()),
        None => icon::embedded(),
    }
}

/// Builds one window from the config template, at `placed`, numbered `ordinal`, and shows it.
///
/// It is not titled here. Every caller follows with [`retitle_all`], once it knows how many
/// windows are open.
fn build<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    placed: Placement,
    ordinal: u32,
) -> anyhow::Result<WebviewWindow<R>> {
    let mut config = app
        .config()
        .app
        .windows
        .first()
        .cloned()
        .unwrap_or_default();
    config.label = label.to_string();
    // Built under the config's own title; `retitle_all` numbers it once the caller knows how many
    // windows there are, since that decides whether the number shows at all.
    // Built hidden and shown once placed, so a restored window never appears at the default spot
    // and then jumps to its own.
    config.visible = false;

    let window = WebviewWindowBuilder::from_config(app, &config)?.build()?;

    if let Some((width, height)) = placed.size {
        window.set_size(tauri::PhysicalSize::new(width, height))?;
    }
    if let Some((x, y)) = placed.position {
        window.set_position(tauri::PhysicalPosition::new(x, y))?;
    }
    // An icon that will not load is a cosmetic failure and never a reason to withhold the window.
    match app_icon(app) {
        Ok(icon) => {
            if let Err(error) = window.set_icon(icon) {
                tracing::warn!(error = %error, label = %label, "could not set a window icon");
            }
        }
        Err(error) => tracing::warn!(error = %error, "could not load the window icon"),
    }
    window.show()?;
    if let Some(names) = app.try_state::<WindowNames>() {
        names.set_ordinal(label, ordinal);
    }
    Ok(window)
}

/// Reopens every window of the saved session, in the order they were opened.
///
/// Called once from the setup hook, before the event loop runs, so that by the time any window's
/// frontend executes a line of JavaScript every window of the session exists — which is what lets
/// the frontend tell a stored tab strip with no window from one whose window has not opened yet.
///
/// A window that fails to build is logged and skipped rather than taking the launch down: one
/// window that will not open is a worse thing to turn into no windows at all.
pub fn restore<R: Runtime>(app: &AppHandle<R>) -> anyhow::Result<()> {
    let session = match app.try_state::<SessionStore>() {
        Some(store) => store.session(),
        None => WindowSession::bootstrap(),
    };
    let displays = displays(app);
    let mut opened = 0usize;

    // Each window gets back the number it was saved with, unless another already has it.
    let saved: Vec<u32> = session
        .windows
        .iter()
        .map(|record| record.ordinal)
        .collect();
    let ordinals = windows::restored_ordinals(&saved);

    for (record, ordinal) in session.windows.iter().zip(ordinals) {
        let placed = windows::placement(record.rect, &displays);
        match build(app, &record.label, placed, ordinal) {
            Ok(_) => opened += 1,
            Err(error) => {
                tracing::error!(error = %error, label = %record.label, "a saved window could not be reopened");
            }
        }
    }

    if opened == 0 {
        // Nothing of the session survived, and an app with no window is an app with no way in.
        build(
            app,
            windows::BOOTSTRAP_LABEL,
            Placement {
                size: None,
                position: None,
            },
            1,
        )?;
    }

    // Numbered only now that every window of the session is open, which is what decides whether
    // any of them shows its number.
    retitle_all(app);
    tracing::info!(windows = opened, "window session restored");
    Ok(())
}

/// Opens a new window under `label`, offset from the window that asked for it.
///
/// The label is the frontend's to mint, because it is also the key the new window's tab strip has
/// already been written under — the tab is in storage before the window exists, so the window
/// finds its own strip on boot and no tab ever travels through an event that could be missed.
#[tauri::command]
pub async fn open_board_window<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    label: String,
) -> Result<(), WireError> {
    if app.get_webview_window(&label).is_some() {
        return Err(WireError::invalid_request(format!(
            "a window labelled {label} is already open"
        )));
    }
    let placed = torn_off_placement(&app, &window);
    // The lowest number no open window wears — see `windows::next_ordinal`. The live registry is
    // asked rather than the saved session, which may be a gesture behind.
    let in_use = app
        .try_state::<WindowNames>()
        .map(|names| names.in_use())
        .unwrap_or_default();
    let ordinal = windows::next_ordinal(&in_use);
    build(&app, &label, placed, ordinal).map_err(|error| WireError::internal(error.to_string()))?;
    snapshot(&app);
    // A second window numbers every title, the first's included, and a window the tray's menu
    // does not list is a window the menu cannot reach. `retitle_all` does both.
    retitle_all(&app);
    Ok(())
}

/// Puts the active tab's name in the window's title, after the window's own number.
///
/// Called by the frontend whenever the active tab changes or is renamed, because only the frontend
/// knows what a tab is called. The **number** stays the backend's: it is fixed for the window's
/// life and the frontend has no business deciding it — nor whether it shows, which depends on the
/// other windows — so what crosses the boundary is the tab name alone and the two are composed
/// here.
#[tauri::command]
pub async fn set_window_title<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    tab: String,
) -> Result<(), WireError> {
    if let Some(names) = app.try_state::<WindowNames>() {
        names.set_tab(window.label(), &tab);
    }
    let open = app.webview_windows().len();
    apply_title(&window, &title_of(&app, window.label(), open))
        .map_err(|error| WireError::internal(error.to_string()))?;
    // The menu lists a window by its title, so a title that changed leaves the menu out of date.
    crate::commands::tray::refresh_menu(&app);
    Ok(())
}

/// Titles `window`: the window title the window manager and the tray read, and the header bar
/// drawn inside the window, which on Wayland does not follow the first. See
/// [`crate::commands::header_bar`]. Every retitle goes through here, so the two cannot drift apart.
fn apply_title<R: Runtime>(window: &WebviewWindow<R>, title: &str) -> tauri::Result<()> {
    window.set_title(title)?;
    header_bar::show_title(window, title);
    Ok(())
}

/// `label`'s title with `open` windows open. See [`windows::window_title`].
fn title_of<R: Runtime>(app: &AppHandle<R>, label: &str, open: usize) -> String {
    let name = name_of(app, label);
    windows::window_title(&base_title(app), name.ordinal, &name.tab, open)
}

/// Retitles every open window and rebuilds the tray menu, for a moment the number of windows may
/// have changed.
///
/// Whether a window shows its number depends on how many are open, so a window opening or closing
/// changes **every** window's title, not only its own — the second window to open numbers the
/// first, and the last but one to close un-numbers the one left. The count is the live window set,
/// hidden windows included: a window put away in the tray is still open.
pub fn retitle_all<R: Runtime>(app: &AppHandle<R>) {
    let live = app.webview_windows();
    let open = live.len();
    for (label, window) in live {
        if let Err(error) = apply_title(&window, &title_of(app, &label, open)) {
            tracing::warn!(error = %error, label = %label, "could not retitle a window");
        }
    }
    crate::commands::tray::refresh_menu(app);
}

/// The app's own name, as the config gives it — which a branch instance overrides.
pub fn base_title<R: Runtime>(app: &AppHandle<R>) -> String {
    app.config()
        .app
        .windows
        .first()
        .map(|config| config.title.clone())
        .unwrap_or_else(|| "Arlesh".to_string())
}

/// The tray menu's per-window entries for the windows open now — none while only one is.
///
/// Composed from the live window set and [`WindowNames`], through the same
/// [`windows::window_title`] every title is set with, so an entry cannot disagree with its
/// window. See [`windows::menu_entries`] for the rule.
pub fn open_windows<R: Runtime>(app: &AppHandle<R>) -> Vec<ListedWindow> {
    let session = match app.try_state::<SessionStore>() {
        Some(store) => store.session(),
        None => WindowSession::bootstrap(),
    };
    let open = open_labels(app, &session)
        .into_iter()
        .filter_map(|label| {
            let window = app.get_webview_window(&label)?;
            let name = name_of(app, &label);
            // Unreadable reads as hidden: the entry then offers to show it, which is harmless.
            let visible = window.is_visible().unwrap_or(false);
            Some(OpenWindow {
                label,
                ordinal: name.ordinal,
                tab: name.tab,
                visible,
            })
        })
        .collect();
    windows::menu_entries(&base_title(app), open)
}

/// Where a window torn out of `from` should appear: beside it, if that is somewhere reachable.
fn torn_off_placement<R: Runtime>(app: &AppHandle<R>, from: &WebviewWindow<R>) -> Placement {
    let Ok(position) = from.outer_position() else {
        return Placement {
            size: None,
            position: None,
        };
    };
    let size = from.inner_size().ok();
    let rect = WindowRect {
        x: position.x + TEAR_OFF_OFFSET,
        y: position.y + TEAR_OFF_OFFSET,
        width: size.map(|size| size.width).unwrap_or(0),
        height: size.map(|size| size.height).unwrap_or(0),
    };
    windows::placement(Some(rect), &displays(app))
}

/// The labels of every open window, oldest first.
///
/// The frontend uses it twice: to offer "move this tab to …" for every window but its own, and to
/// drop the stored tab strips of windows that no longer exist.
#[tauri::command]
pub async fn board_windows<R: Runtime>(app: AppHandle<R>) -> Result<Vec<String>, WireError> {
    let session = match app.try_state::<SessionStore>() {
        Some(store) => store.session(),
        None => WindowSession::bootstrap(),
    };
    Ok(open_labels(&app, &session))
}

/// Brings `label` to the front, for a tab that has just been moved into it.
#[tauri::command]
pub async fn focus_board_window<R: Runtime>(
    app: AppHandle<R>,
    label: String,
) -> Result<(), WireError> {
    let Some(window) = app.get_webview_window(&label) else {
        return Ok(());
    };
    window
        .set_focus()
        .map_err(|error| WireError::internal(error.to_string()))
}
