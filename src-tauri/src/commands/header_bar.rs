//! The title drawn inside a window's own header bar, on Wayland.
//!
//! On Wayland, tao gives every decorated window a client-side title bar of its own: a
//! `gtk::HeaderBar` holding the minimise, maximise and close buttons, wrapped in a `gtk::EventBox`
//! and installed with `set_titlebar` (tao 0.35, `platform_impl/linux/wayland/header.rs`). The
//! header bar's title is set **once**, from the title the window is built with. `set_title` later
//! reaches the compositor, whose bars and window lists follow it, but not that header bar. GTK
//! keeps a header bar in step with the window title only when the header bar is the titlebar
//! itself. Here the titlebar is the `EventBox`, so the header bar goes on reading whatever the
//! window was built as: plain `Arlesh`, before any number is known.
//!
//! So a title change also has to be written into the header bar, and that is this module. It is
//! a no-op everywhere tao draws no such header bar: on X11, on other platforms, and under the
//! mock runtime the tests use.

use tauri::{Runtime, WebviewWindow};

/// Writes `title` into `window`'s client-side header bar, where it has one.
///
/// Call it beside `set_title`, never instead of it: the window title is what the window manager and
/// the tray read. The header bar is a GTK widget and may only be touched on the main thread, so the
/// write is queued there, and a failure to queue it is logged rather than returned. A header bar
/// that shows a stale title is cosmetic. It is no reason to fail the retitle it trails.
#[cfg(target_os = "linux")]
pub fn show_title<R: Runtime>(window: &WebviewWindow<R>, title: &str) {
    // Only the real runtime has GTK widgets behind its windows. The mock runtime's `gtk_window` is
    // `unimplemented!()`, so a window of any other runtime is left alone.
    let window: &dyn std::any::Any = window;
    let Some(window) = window.downcast_ref::<WebviewWindow<tauri::Wry>>() else {
        return;
    };
    let target = window.clone();
    let title = title.to_owned();
    if let Err(error) = window.run_on_main_thread(move || write_header_title(&target, &title)) {
        tracing::warn!(error = %error, "could not queue the header bar title");
    }
}

/// See the Linux [`show_title`]. No other platform draws tao's header bar.
#[cfg(not(target_os = "linux"))]
pub fn show_title<R: Runtime>(_window: &WebviewWindow<R>, _title: &str) {}

/// The header-bar write itself, on the main thread.
#[cfg(target_os = "linux")]
fn write_header_title(window: &WebviewWindow<tauri::Wry>, title: &str) {
    use gtk::prelude::*;

    let gtk_window = match window.gtk_window() {
        Ok(gtk_window) => gtk_window,
        Err(error) => {
            tracing::warn!(error = %error, "could not reach the window's GTK handle");
            return;
        }
    };
    // No titlebar at all is X11, where tao installs none and the window manager draws the title.
    let Some(header) = gtk_window
        .titlebar()
        .and_then(|titlebar| header_bar_in(&titlebar))
    else {
        return;
    };
    header.set_title(Some(title));
}

/// The header bar tao installed as `titlebar`: inside its `EventBox`, or the titlebar itself should
/// a later tao drop the wrapper.
#[cfg(target_os = "linux")]
fn header_bar_in(titlebar: &gtk::Widget) -> Option<gtk::HeaderBar> {
    use gtk::prelude::*;

    if let Some(header) = titlebar.downcast_ref::<gtk::HeaderBar>() {
        return Some(header.clone());
    }
    titlebar
        .downcast_ref::<gtk::EventBox>()?
        .child()?
        .downcast::<gtk::HeaderBar>()
        .ok()
}
