//! Arlesh's icons: the full-colour app icon, and the flat white mark the tray wears.
//!
//! Two different things, deliberately. An **app icon** identifies the window and the launcher, and
//! is the logo in its own colours. A **tray icon** sits on a panel whose colour and theme are not
//! ours to know, so it is a monochrome silhouette — which is also what every other tray icon on
//! that bar is, and looking like a sticker among them is worse than looking plain.
//!
//! Tauri has a mode for exactly this, [`icon_as_template`], but it is macOS-only: on Linux, where
//! Arlesh runs, it is ignored and the bitmap is drawn as given. The silhouette is therefore
//! rendered here rather than asked for.
//!
//! Both come out of assets compiled into the binary. Tauri hands out a window icon from the bundle
//! configuration, but only where a bundle was produced — a plain `cargo run`, which is how a branch
//! instance starts, has none, and the tray would then be an empty slot on the panel.
//!
//! [`icon_as_template`]: tauri::tray::TrayIconBuilder::icon_as_template

use anyhow::Context;
use tauri::image::Image;

pub mod svg;

#[cfg(test)]
mod tests;

/// The 128×128 PNG the app icon is decoded from.
const EMBEDDED_ICON: &[u8] = include_bytes!("../icons/128x128.png");

/// The vector the tray mark is rendered from. The source of truth for its shape: the bitmap is
/// produced from this at whatever size is wanted, never resampled out of a PNG. It is not
/// `icon.svg` — see that file's comment for why the tray gets a simplified mark of its own.
const EMBEDDED_SVG: &str = include_str!("../icons/tray.svg");

/// How large the tray bitmap is rendered.
///
/// A tray asks for 22 to 24 *logical* pixels, and this machine's laptop panel runs at 2x, so 48 is
/// what the bar actually draws. The panel scales whatever it is handed, and scaling is where a mark
/// goes soft — 128 was three times too big and arrived as mush. Rendering at the size the bar wants
/// means it barely has to scale at all.
pub const TRAY_ICON_SIZE: u32 = 48;

/// Decodes a PNG into the RGBA buffer Tauri wants for a window or tray icon.
///
/// Palette and greyscale images, and images with no alpha channel, are expanded rather than
/// refused — Tauri's [`Image`] is RGBA and nothing else.
pub fn decode_png(bytes: &[u8]) -> anyhow::Result<Image<'static>> {
    let mut decoder = png::Decoder::new(bytes);
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::ALPHA);

    let mut reader = decoder.read_info().context("reading PNG header")?;
    let mut buffer = vec![0u8; reader.output_buffer_size()];
    let info = reader.next_frame(&mut buffer).context("decoding PNG")?;
    buffer.truncate(info.buffer_size());

    Ok(Image::new_owned(buffer, info.width, info.height))
}

/// The full-colour app icon compiled into the binary.
pub fn embedded() -> anyhow::Result<Image<'static>> {
    decode_png(EMBEDDED_ICON)
}

/// The tray's mark: Arlesh's shape in flat white, rendered from the SVG at `size`.
pub fn tray_mark(size: u32) -> anyhow::Result<Image<'static>> {
    let silhouette = svg::parse(EMBEDDED_SVG).context("reading the tray icon's SVG")?;
    Ok(Image::new_owned(silhouette.rasterise(size), size, size))
}

/// [`tray_mark`] at [`TRAY_ICON_SIZE`].
pub fn tray() -> anyhow::Result<Image<'static>> {
    tray_mark(TRAY_ICON_SIZE)
}

/// Reorders an RGBA buffer in place into ARGB32, big-endian — alpha first, then red, green, blue.
///
/// The [StatusNotifierItem] protocol, which is how Linux panels are handed an icon, asks for that
/// order and nothing else; Tauri's [`Image`] is RGBA. One rotation per pixel is the whole of the
/// difference. A buffer whose length is not a whole number of pixels leaves its tail alone rather
/// than being refused — a partial pixel is nothing a panel can draw either way.
///
/// [StatusNotifierItem]: https://www.freedesktop.org/wiki/Specifications/StatusNotifierItem/
pub fn rgba_to_argb32(buffer: &mut [u8]) {
    for pixel in buffer.as_chunks_mut::<4>().0 {
        pixel.rotate_right(1);
    }
}

/// The tray mark as a square of ARGB32 bytes, with the side it was rendered at.
///
/// What a Linux panel is given directly, where Tauri's tray takes an [`Image`]. See
/// [`rgba_to_argb32`].
pub fn tray_argb32() -> anyhow::Result<(u32, Vec<u8>)> {
    let mut pixels = tray()?.rgba().to_vec();
    rgba_to_argb32(&mut pixels);
    Ok((TRAY_ICON_SIZE, pixels))
}
