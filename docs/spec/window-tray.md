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
the window they asked to be rid of. Closing a window's **last tab** closes that window, so there is
never an empty one left over.

**Each window keeps its own tabs and filters**; the theme, the clipboard and the Undo/Redo stacks
stay shared. See [Tabs](tabs.md) for what a tab owns, and [Undo](undo.md) for why one history is
right for several windows.

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
click puts it away; none showing brings them all back. The right button opens a menu offering
**Show** and **Quit**: nothing the menu cannot do that a click can, nothing missing that is needed.
**Ctrl+Q** quits from the keyboard and appears in the cheat-sheet. The windows return where and how
they were left, since hiding never destroys them. Quit is a real shutdown — the database session factory and
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

**With no tray, closing means quit.** A desktop with no tray host is an ordinary condition and must
not take the window down with it, so a tray that fails to appear costs the feature and not the app:
the preference is read as off, and the close button means what it meant before any of this — which
is the only honest answer, since hiding a window into a tray that never appeared is a trap.

**No first-close notice.** This is a personal app whose only user knows what its close button does,
and a dialog in front of the gesture being made faster would defeat the point.
