//! Tauri's side of close to tray: the tray icon, its menu, the window's close handler, and the two
//! commands the frontend calls.
//!
//! The decision this file serves is [`crate::tray`], which is pure and tested. Everything here is
//! adapter: it turns a click, a menu selection or an `invoke` into a call on that decision, exactly
//! as the rest of this module turns an `invoke` into a call on a resource operator. Nothing here
//! can be reached without a running event loop, which is why the decision does not live here.
//!
//! # Two trays, because Linux's is a protocol rather than a widget
//!
//! Windows and macOS get the tray Tauri builds, and its [`tauri::tray::TrayIconEvent`] reports the
//! click. Linux gets an icon Arlesh puts on the bar itself, over D-Bus, and that is not a
//! preference — it is the only way a left click can reach the app at all.
//!
//! A Linux tray is the [StatusNotifierItem] protocol: the app exports an object on the session bus
//! and the panel calls `Activate` on it when the icon is clicked. Tauri does not export that object
//! itself. It goes through `tray-icon`, which on Linux is a thin wrapper over libappindicator, and
//! **libappindicator's item has no `Activate` method** — its interface is `Scroll`,
//! `SecondaryActivate` and `XAyatanaSecondaryActivate`, and nothing else. There is no callback to
//! subscribe to and no flag to set: a panel that wants to tell Arlesh about a left click has
//! nothing to call, so `TrayIconEvent` cannot fire, and every panel falls back to opening the menu.
//!
//! Checked 2026-09-22 against `tauri` 2.11.3, `tray-icon` 0.24.1 (whose GTK backend is byte for
//! byte the same in 0.25.1, the newest release) and `libappindicator` 12.10.1 — and confirmed on
//! the bus against a running Arlesh, whose item answered `No such method "Activate"`. The upstream
//! issue is [tauri-apps/tray-icon#104]. `libayatana-appindicator` 0.6.0 does implement `Activate`,
//! but only forwards it when a GObject signal handler is attached, and neither `tray-icon` nor
//! Tauri exposes the indicator far enough to attach one.
//!
//! So on Linux [`ksni`] exports the item instead, with `ItemIsMenu` false, a real `Activate` that
//! toggles the window, and the same two-item menu. The right button still opens that menu; the
//! left button no longer has to.
//!
//! [StatusNotifierItem]: https://www.freedesktop.org/wiki/Specifications/StatusNotifierItem/
//! [tauri-apps/tray-icon#104]: https://github.com/tauri-apps/tray-icon/issues/104

#[cfg(not(target_os = "linux"))]
use tauri::{
    menu::{Menu, MenuEvent, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri::{AppHandle, Manager, Runtime, State, Window, WindowEvent};

use crate::{
    commands::windows,
    icon,
    tray::{activate_action, ActivateAction, CloseAction, ClosePreference},
};

/// The tray icon's own id, which is a different namespace from the window's label.
const TRAY_ID: &str = "arlesh-tray";

/// What the tray says when nothing better is available.
const FALLBACK_TOOLTIP: &str = "Arlesh";

/// The id a per-window entry carries, with the window's label after this prefix.
///
/// Only Tauri's menu needs it; Linux's carries a callback per item. It is declared here anyway
/// because it is part of the menu's shape, which both trays share.
#[cfg(not(target_os = "linux"))]
const WINDOW_ITEM_PREFIX: &str = "window:";

/// What the two fixed menu items read on the bar. Both trays build the same menu from these.
const SHOW_LABEL: &str = "Show";
/// See [`SHOW_LABEL`].
const QUIT_LABEL: &str = "Quit";

/// Menu item ids. They are matched as strings when Tauri's menu fires, so they are named once here.
/// Linux's menu carries a callback per item instead and needs no ids.
#[cfg(not(target_os = "linux"))]
const SHOW_ITEM: &str = "show";
/// See [`SHOW_ITEM`].
#[cfg(not(target_os = "linux"))]
const QUIT_ITEM: &str = "quit";

/// Builds the tray icon and, if it went up, lets the close button start meaning "hide".
///
/// Called once from the setup hook. It also manages the [`ClosePreference`], so that the decision
/// and the surfaces that consult it are installed together — a tray whose Quit could not reach the
/// preference would leave the close handler hiding a window the user asked to be rid of.
///
/// Infallible on purpose, the same bargain [`crate::mcp::serve`] makes with an occupied port: a
/// desktop with no tray host is an ordinary condition, and it must not take the window down with
/// it. What it costs is the feature, not the app — a preference that never hears the tray went up
/// reads as off, so closing goes on meaning quit, which is where Arlesh started.
pub fn install(app: &AppHandle) {
    let preference = ClosePreference::default();

    if let Err(error) = build_tray(app) {
        tracing::error!(error = %error, "no tray icon; the close button keeps quitting");
        app.manage(preference);
        return;
    }

    preference.mark_tray_available();
    app.manage(preference);
    tracing::info!("tray icon ready; closing the last window hides it by default");
}

/// Every window's close button, and the moment a closed window stops existing.
///
/// Registered once, on the builder, rather than per window: a torn-off window is a window like any
/// other and must behave like one, and a handler attached at creation time would have to be
/// remembered by every future path that creates one.
///
/// Two events, two jobs. **CloseRequested** is where the close-to-tray decision is made, and where
/// a session that is about to lose its last window is written down while that window is still
/// there to be read. **Destroyed** is where a window that really went is taken out of the session
/// — but not during a quit, when every window is destroyed in turn and the session was already
/// saved intact.
pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    let app = window.app_handle();
    match event {
        WindowEvent::CloseRequested { api, .. } => {
            let is_last = app.webview_windows().len() <= 1;
            if resolve_close(app, is_last) == CloseAction::HideToTray {
                api.prevent_close();
                hide_windows(app);
                windows::snapshot(app);
                return;
            }
            if is_last {
                // The last window's geometry is only readable while it still exists, and the
                // destruction that follows reports no windows at all.
                windows::snapshot(app);
            }
        }
        // The window in front changed. Nothing in the tray cares, but a tab dropped where two
        // windows overlap does: the most recently focused of them is taken to be the one on top.
        WindowEvent::Focused(true) => {
            if let Some(order) = app.try_state::<windows::FocusOrder>() {
                order.focused(window.label());
            }
        }
        // Not during a quit: every window is destroyed in turn, and the session was written
        // down intact before the first of them went.
        WindowEvent::Destroyed if !quit_requested(app) => {
            windows::snapshot(app);
            // One fewer window to list, and the entries are the only way to reach one.
            refresh_menu(app);
        }
        _ => {}
    }
}

/// Whether a deliberate quit is under way, and so whether a destruction means anything.
fn quit_requested<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.try_state::<ClosePreference>()
        .map(|preference| preference.quit_requested())
        .unwrap_or(false)
}

/// The tray menu: Show, Quit, and one entry per open window.
///
/// Rebuilt rather than mutated, because a menu is a list and the list changes; see
/// [`refresh_menu`] for when.
#[cfg(not(target_os = "linux"))]
fn window_menu<R: Runtime>(
    app: &AppHandle<R>,
    show: &MenuItem<R>,
    quit: &MenuItem<R>,
) -> anyhow::Result<Menu<R>> {
    let menu = Menu::new(app)?;
    menu.append(show)?;
    for (label, title) in windows::open_windows(app) {
        let id = format!("{WINDOW_ITEM_PREFIX}{label}");
        menu.append(&MenuItem::with_id(app, id, title, true, None::<&str>)?)?;
    }
    menu.append(quit)?;
    Ok(menu)
}

/// Rebuilds the tray menu so it lists the windows that are open **now**.
///
/// A menu built once at startup would list that moment's windows forever, and the entries are the
/// only way to reach one window rather than all of them. It is called wherever the set of windows
/// can have changed, which is the same set of moments the window session is written down at.
#[cfg(not(target_os = "linux"))]
pub fn refresh_menu<R: Runtime>(app: &AppHandle<R>) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    let rebuild = || -> anyhow::Result<()> {
        let show = MenuItem::with_id(app, SHOW_ITEM, SHOW_LABEL, true, None::<&str>)?;
        let quit = MenuItem::with_id(app, QUIT_ITEM, QUIT_LABEL, true, None::<&str>)?;
        tray.set_menu(Some(window_menu(app, &show, &quit)?))?;
        Ok(())
    };
    if let Err(error) = rebuild() {
        tracing::warn!(error = %error, "could not rebuild the tray menu");
    }
}

/// Puts the icon and its menu in the tray, through Tauri's own tray.
#[cfg(not(target_os = "linux"))]
fn build_tray(app: &AppHandle) -> anyhow::Result<()> {
    let show = MenuItem::with_id(app, SHOW_ITEM, SHOW_LABEL, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT_ITEM, QUIT_LABEL, true, None::<&str>)?;
    let menu = window_menu(app, &show, &quit)?;

    TrayIconBuilder::with_id(TRAY_ID)
        // The white silhouette, not the colour logo: see `crate::icon`.
        .icon(icon::tray()?)
        // What the silhouette already is, said out loud. macOS is the only platform that acts on
        // it — it tints a template image to suit a light or dark menu bar.
        .icon_as_template(true)
        // The window's title, not a constant: `scripts/branch-instance.sh` titles each branch's
        // window after its branch, and with several instances up their tray icons are otherwise
        // indistinguishable.
        .tooltip(tray_tooltip(app))
        .menu(&menu)
        // The menu belongs to the right button; the left one toggles the window.
        .show_menu_on_left_click(false)
        .on_menu_event(on_menu_event)
        .on_tray_icon_event(|tray, event| on_tray_icon_event(tray.app_handle(), event))
        .build(app)?;

    Ok(())
}

/// Puts the icon and its two-item menu on the bar, as a StatusNotifierItem Arlesh exports itself.
///
/// See this module's header for why Linux does not use the tray Tauri builds. Registering is
/// awaited rather than left to run on: [`install`] only takes over the close button once the tray
/// is up, and a close that hid the window into a tray that never appeared would be a trap.
#[cfg(target_os = "linux")]
fn build_tray(app: &AppHandle) -> anyhow::Result<()> {
    use ksni::TrayMethods;

    let tray = SystemTray::new(app)?;
    let handle = tauri::async_runtime::block_on(tray.spawn())
        .map_err(|error| anyhow::anyhow!("registering the tray item: {error}"))?;

    // Held for the life of the app. The service owns itself once spawned, so this is belt and
    // braces — but it is also what a later tooltip or icon change would go through.
    app.manage(handle);

    Ok(())
}

/// Arlesh's StatusNotifierItem: the icon on a Linux bar, and what its two buttons do.
#[cfg(target_os = "linux")]
struct SystemTray {
    /// The app the click acts on. Every use hops to the main thread — see [`on_main_thread`].
    app: AppHandle,
    /// What the bar shows on hover, and the item's `Title`.
    title: String,
    /// The mark, in the ARGB32 the protocol asks for.
    icon: ksni::Icon,
    /// The open windows, as label and title, for the entries between Show and Quit.
    ///
    /// Held rather than read inside [`ksni::Tray::menu`], which the bar calls on the D-Bus task
    /// and while the service lock is held. Asking Tauri for a window's title from in there means
    /// a round trip to the main thread taken under a lock that the refresh is already holding —
    /// so the list is computed by [`refresh_menu`], outside it, and handed in.
    windows: Vec<(String, String)>,
}

#[cfg(target_os = "linux")]
impl SystemTray {
    /// Reads the icon and the window title once, at build time, since neither changes after.
    fn new(app: &AppHandle) -> anyhow::Result<Self> {
        let (size, data) = icon::tray_argb32()?;
        let side = i32::try_from(size)?;

        Ok(Self {
            app: app.clone(),
            title: tray_tooltip(app),
            windows: windows::open_windows(app),
            icon: ksni::Icon {
                width: side,
                height: side,
                data,
            },
        })
    }
}

#[cfg(target_os = "linux")]
impl ksni::Tray for SystemTray {
    fn id(&self) -> String {
        TRAY_ID.to_string()
    }

    fn title(&self) -> String {
        self.title.clone()
    }

    fn icon_pixmap(&self) -> Vec<ksni::Icon> {
        vec![self.icon.clone()]
    }

    fn tool_tip(&self) -> ksni::ToolTip {
        ksni::ToolTip {
            title: self.title.clone(),
            ..Default::default()
        }
    }

    /// A plain left click. The whole reason this item exists rather than Tauri's.
    fn activate(&mut self, _x: i32, _y: i32) {
        on_main_thread(&self.app, toggle_windows);
    }

    /// Show, then one entry per open window, then Quit.
    ///
    /// Reads only what the struct already holds. The list is refreshed by [`refresh_menu`], which
    /// gathers it outside the service lock and hands it in — see [`SystemTray::windows`].
    ///
    /// A window's entry shows and focuses that one window, where the click on the icon and Show
    /// both act on all of them. That is the division: the icon is the app, the menu reaches into
    /// it.
    fn menu(&self) -> Vec<ksni::MenuItem<Self>> {
        let mut items: Vec<ksni::MenuItem<Self>> = vec![ksni::menu::StandardItem {
            label: SHOW_LABEL.to_string(),
            activate: Box::new(|tray: &mut Self| on_main_thread(&tray.app, show_windows)),
            ..Default::default()
        }
        .into()];

        for (label, title) in self.windows.clone() {
            items.push(
                ksni::menu::StandardItem {
                    label: title,
                    activate: Box::new(move |tray: &mut Self| {
                        let label = label.clone();
                        on_main_thread(&tray.app, move |app| reveal_window(app, &label));
                    }),
                    ..Default::default()
                }
                .into(),
            );
        }

        items.push(
            ksni::menu::StandardItem {
                label: QUIT_LABEL.to_string(),
                activate: Box::new(|tray: &mut Self| on_main_thread(&tray.app, quit)),
                ..Default::default()
            }
            .into(),
        );
        items
    }
}

/// Asks the bar to re-read the item, which is what makes it re-read the menu.
///
/// The window list lives in [`ksni::Tray::menu`] and is read fresh every time the bar asks for it,
/// so nothing here has to compose the entries — this only says "ask again".
#[cfg(target_os = "linux")]
pub fn refresh_menu<R: Runtime>(app: &AppHandle<R>) {
    let Some(handle) = app.try_state::<ksni::Handle<SystemTray>>() else {
        return;
    };
    let handle = handle.inner().clone();
    // Gathered here, before the lock: the titles come from Tauri, which answers them on the main
    // thread, and asking for them from inside the update would be a round trip taken under the
    // service lock that update itself holds.
    let open = windows::open_windows(app);
    // `update` is async — it takes that lock and then waits for the bar to acknowledge — so it is
    // spawned rather than awaited. Every caller is a window event or a command that has no
    // business blocking on a desktop bar answering, and nothing downstream depends on the menu
    // having been redrawn by the time this returns.
    tauri::async_runtime::spawn(async move {
        handle
            .update(|tray: &mut SystemTray| tray.windows = open)
            .await;
    });
}

/// Runs `action` on the thread that owns the windows.
///
/// The StatusNotifierItem answers D-Bus on the async runtime, not on the main thread, and showing
/// or hiding a window from anywhere else is not something to rely on. A failure here means the
/// event loop is gone, which is to say the app is already on its way out.
#[cfg(target_os = "linux")]
fn on_main_thread(app: &AppHandle, action: impl FnOnce(&AppHandle) + Send + 'static) {
    let handle = app.clone();
    if let Err(error) = app.run_on_main_thread(move || action(&handle)) {
        tracing::warn!(error = %error, "the tray could not reach the main thread");
    }
}

/// What the tray icon says on hover: a window's title, else [`FALLBACK_TOOLTIP`].
///
/// Any window's, because they all carry the same one — `scripts/branch-instance.sh` titles a
/// branch's windows after its branch, and with several instances up their tray icons are otherwise
/// indistinguishable.
fn tray_tooltip(app: &AppHandle) -> String {
    app.webview_windows()
        .values()
        .find_map(|window| window.title().ok())
        .filter(|title| !title.is_empty())
        .unwrap_or_else(|| FALLBACK_TOOLTIP.to_string())
}

/// What this close request means, according to the managed [`ClosePreference`].
///
/// A missing preference means the setup hook did not install one, and the honest answer is then
/// the old behaviour: let the window close rather than trap the user in an app with no tray.
fn resolve_close<R: Runtime>(app: &AppHandle<R>, is_last_window: bool) -> CloseAction {
    match app.try_state::<ClosePreference>() {
        Some(preference) => preference.action(is_last_window),
        None => {
            tracing::warn!("no close preference is managed; closing the window quits");
            CloseAction::Close
        }
    }
}

#[cfg(not(target_os = "linux"))]
fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        SHOW_ITEM => show_windows(app),
        QUIT_ITEM => quit(app),
        id if id.starts_with(WINDOW_ITEM_PREFIX) => {
            reveal_window(app, &id[WINDOW_ITEM_PREFIX.len()..]);
        }
        // Every other menu in the app comes through here too, so an unrecognised id is ordinary.
        _ => {}
    }
}

#[cfg(not(target_os = "linux"))]
fn on_tray_icon_event(app: &AppHandle, event: TrayIconEvent) {
    // On release, not on press: a press that turns into a drag is not a click.
    if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
    } = event
    {
        toggle_windows(app);
    }
}

/// Shows every window and puts the keyboard into the last one to come back.
///
/// Every window, because the tray holds the app rather than a window: a two-monitor arrangement
/// put away with one click has to come back with one click, and there is no window among them that
/// is more "the app" than the others.
pub fn show_windows(app: &AppHandle) {
    for window in app.webview_windows().values() {
        if let Err(error) = window.show() {
            tracing::warn!(error = %error, "could not show a window");
            continue;
        }
        if let Err(error) = window.set_focus() {
            tracing::warn!(error = %error, "could not focus a window");
        }
    }
}

/// Shows one window and puts the keyboard in it, for a click on its own tray entry.
///
/// The one place anything in the tray acts on a single window. The icon holds the app, so a click
/// on it toggles them all; the menu is how you reach past that to the window you want.
fn reveal_window<R: Runtime>(app: &AppHandle<R>, label: &str) {
    let Some(window) = app.get_webview_window(label) else {
        return;
    };
    if let Err(error) = window.show() {
        tracing::warn!(error = %error, label = %label, "could not show the window");
        return;
    }
    if let Err(error) = window.set_focus() {
        tracing::warn!(error = %error, label = %label, "could not focus the window");
    }
}

/// Hides every window, leaving the process — and the MCP endpoint — running.
fn hide_windows<R: Runtime>(app: &AppHandle<R>) {
    for window in app.webview_windows().values() {
        if let Err(error) = window.hide() {
            tracing::warn!(error = %error, "could not hide a window to the tray");
        }
    }
}

/// Puts the windows away when any of them is showing, and brings them back when none is.
///
/// What the decision is, and why an unreadable visibility shows rather than hides, is
/// [`activate_action`]. It is asked once for the app rather than once per window, so that one
/// click never hides one window and shows another.
fn toggle_windows(app: &AppHandle) {
    let mut any_visible = None;
    for window in app.webview_windows().values() {
        match window.is_visible() {
            Ok(visible) => any_visible = Some(any_visible.unwrap_or(false) || visible),
            Err(error) => {
                tracing::warn!(error = %error, "could not read a window's visibility");
            }
        }
    }

    match activate_action(any_visible) {
        ActivateAction::Hide => hide_windows(app),
        ActivateAction::Show => show_windows(app),
    }
}

/// Ends the process, the way closing the window used to.
///
/// The session is written down **before** the quit is marked, while every window is still open and
/// still has a position to read. After that the windows are destroyed one at a time, and those
/// destructions are deliberately ignored — see [`on_window_event`] — so that a quit records the
/// arrangement the user quit with rather than the empty desktop it ends on.
///
/// `exit` unwinds Tauri's own shutdown — the managed
/// [`SessionFactory`](crate::database::session::SessionFactory) and the async runtime the MCP
/// listener lives on are dropped with the app — where `process::exit` would abandon both.
pub fn quit(app: &AppHandle) {
    windows::snapshot(app);
    if let Some(preference) = app.try_state::<ClosePreference>() {
        preference.request_quit();
    }
    tracing::info!("quitting Arlesh");
    app.exit(0);
}

/// Mirrors the frontend's stored close-to-tray setting onto the backend that acts on it.
///
/// Called on start and on every change. Until it arrives the backend runs on
/// [`DEFAULT_CLOSE_TO_TRAY`](crate::tray::DEFAULT_CLOSE_TO_TRAY), which is the same default the
/// stored setting has.
#[tauri::command]
pub fn set_close_to_tray(enabled: bool, preference: State<'_, ClosePreference>) {
    preference.set_close_to_tray(enabled);
}

/// Quits Arlesh. The keyboard's half of the tray menu's Quit.
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    quit(&app);
}
