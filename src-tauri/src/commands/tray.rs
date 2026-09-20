//! Tauri's side of close to tray: the tray icon, its menu, the window's close handler, and the two
//! commands the frontend calls.
//!
//! The decision this file serves is [`crate::tray`], which is pure and tested. Everything here is
//! adapter: it turns a click, a menu selection or an `invoke` into a call on that decision, exactly
//! as the rest of this module turns an `invoke` into a call on a resource operator. Nothing here
//! can be reached without a running event loop, which is why the decision does not live here.
//!
//! # Platform note
//!
//! Tray *click* events are not emitted on Linux — the icon is shown and its menu opens, but
//! [`tauri::tray::TrayIconEvent`] never fires. [`toggle_window`] is therefore reached only on
//! Windows and macOS, and the menu's **Show** is the route back to a hidden window on Linux, which
//! is the platform Arlesh runs on.

use tauri::{
    menu::{Menu, MenuEvent, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State, WindowEvent,
};

use crate::{
    icon,
    tray::{CloseAction, ClosePreference},
};

/// The label of the window the tray shows, hides and quits.
const MAIN_WINDOW: &str = "main";

/// The tray icon's own id, which is a different namespace from the window's label.
const TRAY_ID: &str = "arlesh-tray";

/// What the tray says when nothing better is available.
const FALLBACK_TOOLTIP: &str = "Arlesh";

/// Menu item ids. They are matched as strings when the menu fires, so they are named once here.
const SHOW_ITEM: &str = "show";
/// See [`SHOW_ITEM`].
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

/// Puts the icon and its two-item menu in the tray.
fn build_tray(app: &AppHandle) -> anyhow::Result<()> {
    let show = MenuItem::with_id(app, SHOW_ITEM, "Show", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, QUIT_ITEM, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    TrayIconBuilder::with_id(TRAY_ID)
        // The white silhouette, not the colour logo: see `crate::icon`.
        .icon(icon::tray()?)
        // What the silhouette already is, said out loud. macOS is the only platform that acts on
        // it — it tints a template image to suit a light or dark menu bar — and on Linux, where
        // Arlesh runs, it is ignored and the white bitmap is drawn as rendered.
        .icon_as_template(true)
        // The window's title, not a constant: `scripts/branch-instance.sh` titles each branch's
        // window after its branch, and with several instances up their tray icons are otherwise
        // indistinguishable.
        .tooltip(tray_tooltip(app))
        .menu(&menu)
        // The menu belongs to the right button; the left one toggles the window. Ignored on Linux,
        // where the toolkit opens the menu on either button and says nothing about the click.
        .show_menu_on_left_click(false)
        .on_menu_event(on_menu_event)
        .on_tray_icon_event(|tray, event| on_tray_icon_event(tray.app_handle(), event))
        .build(app)?;

    Ok(())
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

fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        SHOW_ITEM => show_window(app),
        QUIT_ITEM => quit(app),
        // Every other menu in the app comes through here too, so an unrecognised id is ordinary.
        _ => {}
    }
}

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
/// An unreadable visibility shows it: the click was made by someone who wants the window, and a
/// window that appears when it was already there is a far smaller surprise than one that vanishes.
fn toggle_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    match window.is_visible() {
        Ok(true) => hide_window(app),
        Ok(false) => show_window(app),
        Err(error) => {
            tracing::warn!(error = %error, "could not read window visibility; showing it");
            show_window(app);
        }
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
