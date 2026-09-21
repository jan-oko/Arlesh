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
use tauri::{AppHandle, Manager, State, WindowEvent};

use crate::{
    icon,
    tray::{activate_action, ActivateAction, CloseAction, ClosePreference},
};

/// The label of the window the tray shows, hides and quits.
const MAIN_WINDOW: &str = "main";

/// The tray icon's own id, which is a different namespace from the window's label.
const TRAY_ID: &str = "arlesh-tray";

/// What the tray says when nothing better is available.
const FALLBACK_TOOLTIP: &str = "Arlesh";

/// What the two menu items read on the bar. Both trays build the same menu from these.
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

/// Builds the tray icon and, if it went up, takes over the main window's close button.
///
/// Called once from the setup hook. It also manages the [`ClosePreference`], so that the decision
/// and the surfaces that consult it are installed together — a tray whose Quit could not reach the
/// preference would leave the close handler hiding a window the user asked to be rid of.
///
/// Infallible on purpose, the same bargain [`crate::mcp::serve`] makes with an occupied port: a
/// desktop with no tray host is an ordinary condition, and it must not take the window down with
/// it. What it costs is the feature, not the app — with no tray to restore the window from, the
/// close handler is never attached and closing goes on meaning quit, which is where Arlesh started.
pub fn install(app: &AppHandle) {
    app.manage(ClosePreference::default());

    if let Err(error) = build_tray(app) {
        tracing::error!(error = %error, "no tray icon; the close button keeps quitting");
        return;
    }

    let handle = app.clone();
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        window.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if resolve_close(&handle) == CloseAction::HideToTray {
                    api.prevent_close();
                    hide_window(&handle);
                }
            }
        });
    }

    tracing::info!("tray icon ready; closing the window hides it by default");
}

/// Puts the icon and its two-item menu in the tray, through Tauri's own tray.
#[cfg(not(target_os = "linux"))]
fn build_tray(app: &AppHandle) -> anyhow::Result<()> {
    let show = MenuItem::with_id(app, SHOW_ITEM, SHOW_LABEL, true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT_ITEM, QUIT_LABEL, true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

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
        on_main_thread(&self.app, toggle_window);
    }

    fn menu(&self) -> Vec<ksni::MenuItem<Self>> {
        vec![
            ksni::menu::StandardItem {
                label: SHOW_LABEL.to_string(),
                activate: Box::new(|tray: &mut Self| on_main_thread(&tray.app, show_window)),
                ..Default::default()
            }
            .into(),
            ksni::menu::StandardItem {
                label: QUIT_LABEL.to_string(),
                activate: Box::new(|tray: &mut Self| on_main_thread(&tray.app, quit)),
                ..Default::default()
            }
            .into(),
        ]
    }
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

/// What the tray icon says on hover: the main window's title, else [`FALLBACK_TOOLTIP`].
fn tray_tooltip(app: &AppHandle) -> String {
    app.get_webview_window(MAIN_WINDOW)
        .and_then(|window| window.title().ok())
        .filter(|title| !title.is_empty())
        .unwrap_or_else(|| FALLBACK_TOOLTIP.to_string())
}

/// The window's icon: Tauri's bundled one where a bundle exists, else the embedded PNG.
fn app_icon(app: &AppHandle) -> anyhow::Result<tauri::image::Image<'static>> {
    match app.default_window_icon().cloned() {
        // `to_owned` is what lifts a borrowed bundle icon out of the app it came from.
        Some(icon) => Ok(icon.to_owned()),
        None => icon::embedded(),
    }
}

/// Applies [`app_icon`] to the main window, which a `cargo run` build would otherwise leave bare.
pub fn set_window_icon(app: &AppHandle) -> anyhow::Result<()> {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return Ok(());
    };
    window.set_icon(app_icon(app)?)?;
    Ok(())
}

/// What this close request means, according to the managed [`ClosePreference`].
///
/// A missing preference means the setup hook did not install one, and the honest answer is then
/// the old behaviour: let the window close rather than trap the user in an app with no tray.
fn resolve_close(app: &AppHandle) -> CloseAction {
    match app.try_state::<ClosePreference>() {
        Some(preference) => preference.action(),
        None => {
            tracing::warn!("no close preference is managed; closing the window quits");
            CloseAction::Quit
        }
    }
}

#[cfg(not(target_os = "linux"))]
fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        SHOW_ITEM => show_window(app),
        QUIT_ITEM => quit(app),
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
        toggle_window(app);
    }
}

/// Shows the main window and puts the keyboard back in it.
pub fn show_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    if let Err(error) = window.show() {
        tracing::warn!(error = %error, "could not show the window");
        return;
    }
    if let Err(error) = window.set_focus() {
        tracing::warn!(error = %error, "could not focus the window");
    }
}

/// Hides the main window, leaving the process — and the MCP endpoint — running.
fn hide_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    if let Err(error) = window.hide() {
        tracing::warn!(error = %error, "could not hide the window to the tray");
    }
}

/// Hides the window when it is showing and shows it when it is not.
///
/// What the decision is, and why an unreadable visibility shows rather than hides, is
/// [`activate_action`].
fn toggle_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    let visible = window.is_visible().map_err(|error| {
        tracing::warn!(error = %error, "could not read window visibility; showing it");
    });

    match activate_action(visible.ok()) {
        ActivateAction::Hide => hide_window(app),
        ActivateAction::Show => show_window(app),
    }
}

/// Ends the process, the way closing the window used to.
///
/// The preference is marked first so that any close arriving as part of this shutdown is let
/// through instead of being turned back into a hide. `exit` unwinds Tauri's own shutdown — the
/// managed [`SessionFactory`](crate::database::session::SessionFactory) and the async runtime the
/// MCP listener lives on are dropped with the app — where `process::exit` would abandon both.
pub fn quit(app: &AppHandle) {
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
