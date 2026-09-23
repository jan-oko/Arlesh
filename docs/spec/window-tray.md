# Windows & Tray

*One area of the [Arlesh design specification](../../SPEC.md).*

## Windows

**Every window is a tab strip.** A tab torn out of one becomes a window that opens, closes,
switches, reorders and adds tabs exactly like the one it came from, because it is built from the
same component and, underneath, from the same configuration. The alternative considered was a
torn-off window being a single pinned view with no strip of its own: simpler and visually lighter,
but it creates two kinds of window to reason about, and you cannot add a tab to such a window
without tearing another one off to get it.

That sameness goes all the way down. `tauri.conf.json` marks its window `"create": false`, so
nothing is opened at startup by the framework and **every** window — including the first — is built
by Arlesh from that same config as a template. There is no window that came into being differently
from the others, and a restored session gets its windows back under the labels it saved, which is
what each window's tabs are stored beside.

**One backend, one database, one MCP endpoint, one writer.** Windows are additional webviews on the
same process. Agents and the app still see exactly one board.

**Closing a window that is not the last one just closes it.** The preference below is about what
happens when the app is about to have no window left — that is the only close that could cost
anything, because it is the only one that would take the process and the MCP endpoint with it.
Hiding a window to the tray while others stayed open would hand the user a menu entry instead of
the window they asked to be rid of. Closing a window's **last tab** — `Ctrl+W` among the ways — closes that window through this same
close request, so it is decided exactly as the close button is, and there is
never an empty one left over.

**Each window keeps its own tabs and filters**; the theme, the clipboard and the Undo/Redo stacks
stay shared. See [Tabs](tabs.md) for what a tab owns, and [Undo](undo.md) for why one history is
right for several windows.

**Where a torn-off window appears is the compositor's decision.** Decided 2026-09-23: Arlesh keeps
the placement the window manager gives it, and does not place the window itself. Following the
pointer the way a browser's torn-off tab does is not reachable on the Wayland compositor this is
used on (Hyprland 0.55.4), by either route a browser uses:

- **`xdg-toplevel-drag-v1`**, which attaches a toplevel to the drag in progress, is not
  implemented — [hyprwm/Hyprland#10456](https://github.com/hyprwm/Hyprland/issues/10456) is open,
  and 0.55.4's `src/protocols/` has no such protocol. GTK 3, which Tauri renders through, has no
  API for it either, so it would also need a native Wayland binding beside GTK.
- **Interactive move** (`xdg_toplevel.move`, what Tauri's `startDragging()` requests on Wayland) is
  ignored: 0.55.4's `XDGShell.cpp` installs no move or resize handler.
  [hyprwm/Hyprland#12164](https://github.com/hyprwm/Hyprland/pull/12164), which adds them, is not
  merged.

Rejected for now: placing the new window at the cursor through Hyprland's IPC socket — code for one
compositor, and it would land the window rather than let it follow the drag. **Revisit** when
#12164 or #10456 lands: interactive move would let the new window follow the pointer through
`startDragging()` with no binding.

## The board-changed broadcast

Every mutation used to end in a reload **in the window that issued it**, which was the whole story
while there was one window. A second window onto the same database would never hear about the
first's edits, and two views of one board that silently disagree are worse than one view.

So a committed change announces itself, and every other window **reloads** — the same reload that
already runs after a local edit, not a second refresh path invented for this. The Mindmap loads in
a single request, so it is cheap enough to do unconditionally. Rejected: per-window polling, which
needs no backend change but is either laggy or wasteful and keeps re-reading an idle board; and no
sync at all, which is free to build and produces two windows onto one database that quietly
disagree.

The event carries **no payload**. It is a signal to reload, not a diff: a payload would be a second
description of the change living beside the change itself, free to drift from it, where a bare
signal cannot be wrong about anything.

**It is emitted at the Gesture boundary, after the commit — derived from the Undo Journal rather
than written into each command.** The obvious reading of "every mutating command announces" is a
line at the end of all 83 of them, and that is the obligation [ADR
0006](../adr/0006-undo-via-a-trigger-written-row-journal.md) already refused for undo, for the same
reason: an obligation met 83 times and again by every command written afterwards is one that will
eventually be forgotten, silently, by the command least likely to be tested for it. The journal
those commands already write is asked instead — a Gesture closes, the backend asks whether it wrote
anything, and announces when it did. A command that wrote nothing to the journal wrote nothing to
the board, and the test that fails for any table whose writes are not journaled already exists. The
per-command obligation is gone rather than restated.

It asks the journal a slightly different question from the one undo asks. Undo wants the **user's**
writes, because Ctrl+Z is a history of the user; the other windows want **anybody's**, because a
window showing a node an agent has just relabelled is wrong regardless of who relabelled it. So an
agent's write announces without ever entering the Undo Stack.

Two writes the journal cannot see announce themselves directly. **Undo and redo** suppress
journalling for the length of their own transaction — reversing a change must not become a change
to reverse — so the two commands that make one say so. And an **MCP write** does not go through the
Gesture protocol at all; the endpoint gets a way to announce of its own, which also fixes something
that was already wrong: an agent setting a `beads_id` used to leave an open window showing the old
value.

**Every window listens for events addressed to itself, by its own label.** Tauri's `listen` with
no target hears every event whatever window it was sent to, so without the label an announcement
sent once to each other window reached every window once per other window — each change reloaded
every window, the one that made it included, N−1 times — and a tab handed to one window was adopted
by all of them. The same holds for the tab hand-over and the drag claim.

**The window that made the change is not told.** It reloads on the way back from its own command,
which is the path this reuses; telling it as well would buy a second identical read of the board for
every edit.

## Session restore

**Which windows were open, and where, is the backend's to write down** — a JSON file beside the
database. Not the frontend's, because only the backend can tell a window that was really closed
from one hidden to the tray or taken down by a quit, and a frontend that guessed would either
resurrect a window the user closed or lose one they did not. Its counterpart is that the **tabs** in
those windows stay the frontend's, under each window's label; see [Tabs](tabs.md).

Geometry is saved as the outer position and the inner size, in physical pixels, and a restored
window is placed after it is built rather than through the builder — the builder's coordinates are
logical, and a session saved at one scale factor and replayed through logical coordinates lands
somewhere else. Windows are built hidden and shown once placed, so restoring never shows a window
jumping from a default spot to its own.

**A window whose saved position is on no connected display reopens at a default position**, keeping
its size. This is the one case where restoring faithfully is worse than not: a window reopened on a
monitor that has been unplugged is a window the user cannot reach. "On a display" is deliberately
generous — a window may legitimately hang off an edge, so what is required is 64 pixels of it in
both axes, or the whole of it in an axis where it is smaller than that. An empty display list is
read as "we could not ask", not "there are no screens", and the saved position is honoured:
scattering a restored session because a monitor enumeration failed would be a bad trade.

**An empty session is never written down.** The windows of a quitting app are destroyed one at a
time, and the last of those destructions reports no open windows at all; writing that down would
turn "I closed Arlesh" into "Arlesh has no windows" and throw away a two-monitor arrangement. A quit
therefore writes the session while every window is still open, and the destructions that follow are
ignored.

## The tray

Arlesh sits in the **system tray** for as long as it is running, and closing the **last** window
**hides it there** rather than quitting. The app is open all day and consulted in short bursts, so the most
reflexive control on the screen should not be the one that ends the session — and the process
staying up is what keeps the MCP endpoint below answering and makes reopening instant rather than a
cold start.

**A setting, on by default.** *Close to tray* sits in the settings popover beside *Light mode*,
persists with it, and applies everywhere — what the close button does is not a property of a view, a
tab or a window. It governs the **last** window's close and no other. Turn it off and the close button means quit again, as it used to. On by default, because a
setting that has to be found first would leave the endpoint down for anyone who never looked; a
malformed stored value falls back to on rather than being read as falsy.

**Getting back, and getting out.** A left click on the tray icon toggles the windows — the shortest
gesture for the thing done most often. It is one answer for the whole app rather than one per
window: the tray holds Arlesh, not a window, and a click that hid one window and showed another
would be a gesture with no stable meaning. Any window showing means the app is on screen, so the
click puts it away; none showing brings them all back. **Ctrl+Q** quits from the keyboard and
appears in the cheat-sheet. The windows return where and how they were left, since hiding never
destroys them.

The right button opens a menu: **Show**, then **one entry per open window** while two or more are
open, then **Quit**. That is the division — the icon is the app and acts on all of it, the menu is
how you reach past that into one window. With a single window the two are the same thing, so the
menu is just Show and Quit. A window's entry is a **check item, checked while that window is on screen**, and
clicking it hides or shows that window alone; shown, it also takes the keyboard. The menu is
rebuilt whenever a window opens, closes, is hidden or shown, or changes its title, because a menu
whose checks or entries lag behind the windows is worse than no menu at all. Whether a check mark is
drawn is the tray host's business: the entry is published as a checkmark item, and a host that
does not draw those still toggles the window.

**While several windows are open, each is numbered in its own title.** The title reads
`Arlesh [2] — Bugfixes`: the number in brackets, which stays put, and the active tab, which is what
you actually recognise the window by. The window manager shows that title in its bars and window
lists, and the tray entry is the same title, so an entry and its window are matched at a glance.
In a branch instance the number follows the whole of the config title, branch included, and comes
before the tab: `Arlesh — <branch> [2] — Bugfixes`.

**A lone window shows no number.** Decided 2026-09-23: with one window open the title reads
`Arlesh`, or `Arlesh — Bugfixes`, as it did before numbering existed, and the tray menu has no
per-window list. A number is there to tell windows apart, and one window has nothing to be told
apart from. The number is still **assigned** — it is only not shown — so the rules below are
untouched. It updates live: the second window to open numbers both titles and adds the list, and
closing back down to one takes both away. "Open" is the live window set, hidden ones included: a
window put away in the tray is still open, and still counts. Because a window's title now depends
on the others, the backend keeps each window's last-reported tab name beside its number and
retitles every window whenever one opens or closes.

**A window keeps its number while it is open, and it comes back with it.** Close window 2 of three
and window 3 stays 3 — a number that moved when something else closed would make the menu entry
you learned point somewhere else a minute later. The **next** window opened takes the lowest number
no open window wears, so the 2 is handed out again: nothing refers to a closed window, and a small
set of small numbers tells the open ones apart best. The numbers are saved with the session and
each restored window gets its own back; a number two saved windows both claim — a session saved
before windows were numbered reads every window as 1 — goes to the first, and the others take the
lowest free ones. The number is the backend's, and the tab name is the frontend's, so what crosses
between them is the tab name alone and the two are composed on the backend side. Two places knowing
how a window is named is one too many. Quit is a real shutdown — the database session factory and
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

**The tray item is called Arlesh.** Its title, its tooltip and its StatusNotifierItem `Id` are all
the app's name — never an internal identifier, because bars show the `Id`: DankMaterialShell heads
the item's menu with it. Not a window's title either, which carries a number and a tab, while the
tray holds the app. A branch instance keeps the suffix its config title already carries.

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

**With no tray, closing means quit.** A desktop with no tray host is an ordinary condition and must
not take the window down with it, so a tray that fails to appear costs the feature and not the app:
the preference is read as off, and the close button means what it meant before any of this — which
is the only honest answer, since hiding a window into a tray that never appeared is a trap.

**No first-close notice.** This is a personal app whose only user knows what its close button does,
and a dialog in front of the gesture being made faster would defeat the point.
