# Window & Tray

*One area of the [Arlesh design specification](../../SPEC.md).*

Arlesh sits in the **system tray** for as long as it is running, and closing the window **hides it
there** rather than quitting. The app is open all day and consulted in short bursts, so the most
reflexive control on the screen should not be the one that ends the session — and the process
staying up is what keeps the MCP endpoint below answering and makes reopening instant rather than a
cold start.

**A setting, on by default.** *Close to tray* sits in the settings popover beside *Light mode*,
persists with it, and applies everywhere — what the close button does is not a property of a view or
a tab. Turn it off and the close button means quit again, as it used to. On by default, because a
setting that has to be found first would leave the endpoint down for anyone who never looked; a
malformed stored value falls back to on rather than being read as falsy.

**Getting back, and getting out.** A left click on the tray icon toggles the window — the shortest
gesture for the thing done most often. The right button opens a menu offering **Show** and
**Quit**: nothing the menu cannot do that a click can, nothing missing that is needed. **Ctrl+Q**
quits from the keyboard and appears in the cheat-sheet. The window returns where and how it was
left, since hiding never destroys it. Quit is a real shutdown — the database session factory and
the MCP listener are released with the app, not abandoned.

**On Linux the tray icon is Arlesh's own, not Tauri's.** A Linux tray is a protocol, not a widget:
the app exports a [StatusNotifierItem](https://www.freedesktop.org/wiki/Specifications/StatusNotifierItem/)
on the session bus and the panel calls `Activate` on it when the icon is clicked. Tauri exports
that object through libappindicator, whose item has no `Activate` method at all — so a panel has
nothing to call, and every one of them falls back to opening the menu. That is a hole in the
library, not a platform limit, and the only way through it is to export the item directly, which is
what Arlesh does. It costs a dependency and buys back the plainest gesture the feature has, plus
the hover tooltip libappindicator drops. Windows and macOS keep the tray Tauri builds, whose click
events work.

**The tray mark is monochrome, and it is not the logo.** A tray sits on a bar whose colour and
theme are not the app's to know, and every other icon on it is a flat silhouette; the full-colour
logo would read as a sticker among them. It would also be unreadable: the logo is seven chevrons
whose gaps are under a pixel at the 22–24 logical pixels a tray asks for, so it greys over into a
smear. The tray therefore has a mark of its own, `icons/tray.svg` — the same stack of chevrons cut
to three, each thick enough to survive with clear air between them — rasterised at the size the bar
actually draws rather than resampled down from a larger bitmap, which is the other way a tray icon
goes soft. It is filled flat white with the shape carried by alpha. Tauri has a mode that says this
out loud, `icon_as_template`, but only macOS acts on it. The window and launcher keep the
full-colour logo, which is what an app icon is for.

**No first-close notice.** This is a personal app whose only user knows what its close button does,
and a dialog in front of the gesture being made faster would defeat the point.
