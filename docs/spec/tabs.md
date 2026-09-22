# Tabs

*One area of the [Arlesh design specification](../../SPEC.md).*

Arlesh holds several places on the board open at once. A **tab** owns everything about a view of
the board — its **subtree root**, whether it shows the Mindmap or the List, its branch orientation,
its whole Mindmap filter set, its whole List View filter set, its selection, its collapsed nodes,
the Habit histories it has opened and its pan/zoom — and switching tabs swaps all of it at once. "What is left in Bugfixes" and "what am I
doing today" are two different subtrees under two different presets, and a tab each is how both are
held. Nothing a tab owns is reachable from another tab: exiting a subtree, changing a preset or
collapsing a branch in one leaves every other exactly where it was.

**Theme and the clipboard are app-wide**, along with the Undo/Redo stacks and the List View's
**Path icons** preference. The clipboard deliberately so — cutting a subtree in one tab and pasting
it in another is the obvious thing to want from a second tab, and nothing about a clipboard is
specific to where it was filled. The theme likewise: the app must not change appearance as you move
between tabs. The branch axis is per tab, because a wide subtree may want to be vertical while
another stays horizontal; path glyphs are not, because they are a matter of taste about how the
List View reads, the way the theme is.

**The strip** sits above the top bar, so the top bar stays the active tab's controls and does not
have to know that tabs exist. Each tab is labelled by the subtree it is rooted at; one showing the
whole tree is labelled **All** rather than left nameless. The strip offers a **+**, an **×** per
tab, **middle-click** to close, and **drag** to reorder.

**Naming a tab.** A tab can be given a name of its own — right-click it for a small menu of
**Rename tab** and **Close tab** (the second doing exactly what the × does, last tab included).
Rename turns the label into a text field in place: **Enter** commits, **Escape** cancels and leaves
the name as it was, clicking away commits what was typed, and the field opens focused and selected.
The strip truncates as it always did, so a long name reads in the tab's tooltip.

The name is a **separate field beside the derived label**, not a value written into it. The label is
rewritten from the subtree descriptor every time a tab is navigated, so a name stored there would
survive exactly until the next navigation and then vanish with nothing said. Held beside it, the
name simply wins while it is set while the label carries on being maintained underneath — which is
also what makes clearing it safe: **committing an empty name takes the name off**, and the label
that reappears is already the one for where the tab is now, not the one it had when it was named. An
empty field shows that label as its placeholder, so what clearing would give back is on screen
before you commit it. There is deliberately no second "reset" entry in the menu: emptying the field
is the one way back, and a menu item that only sometimes applies is worse than a field that always
does. A tab's name is never derived from anything, so nothing but the user ever changes it.

The menu is its own component rather than the Mindmap's node menu generalised: every branch in that
one asks a question about a node — its kind, its parent's kind, what it already contains, what is on
the clipboard — and none of them can be asked of a tab.

**Shortcuts** follow the browser conventions, and are declared in the same registry every other
binding is (`src/utils/hotkeys/`), so the cheat-sheet lists them with the rest:

- `Ctrl+T` — open a tab **at the current subtree root**, so opening one to look at something nearby
  costs no navigation. Everything else about it is fresh: a new tab does not inherit filters.
- `Ctrl+W` — close the tab. Closing the **last** tab closes the window, so there is never an empty
  one left over. The app takes `Ctrl+W` itself (capture-phase, `preventDefault`); Arlesh declares no
  native menu accelerator that would claim it first.
- `Ctrl+Tab` / `Ctrl+Shift+Tab` — cycle forward and back, wrapping at both ends
- `Ctrl+1`–`Ctrl+9` — jump to a tab by position

These are **global** bindings: unlike the view-level ones they stay live while a modal or the
cheat-sheet is open, because switching tabs is never ambiguous about what it would act on. They are
still suppressed inside a text input, like every other binding.

**The board alone.** `F11` hides the tab strip and the top bar, leaving the view filling the window;
`F11` again brings them back. Bare `F` does the same, but **only when nothing is selected** — with a
selection, `F` keeps its existing meaning of converting that node to a Flow, and in List View the
same rule holds so one gesture does not mean two things depending on which view you are in. The two
`F` bindings carry complementary guards, so exactly one is ever eligible and the order between them
cannot matter.

This hides *Arlesh's own* chrome and leaves the OS window alone, so it works windowed as well as
maximised. The mode is **app-wide, not per tab** — it is a way of looking at the app for a while
rather than a property of the place you are looking at, and hiding the strip in one tab while
another kept it would make switching tabs resize the board. It is deliberately **not persisted**:
reopening Arlesh with no chrome and no visible way back is a bad first second, and re-entering costs
one keystroke. Every tab shortcut stays live while the strip is hidden — the bindings never depended
on it being drawn.

**Persistence.** The tab list, its order, which tab was active, any name a tab was given, and each
tab's subtree root, view, orientation, both filter sets and opened Habit histories are restored on
reopening. A strip
written down before tabs could be named comes back as tabs with no names, labelled as they were. Selection, collapsed nodes and pan/zoom
are **not**: they are working state, and coming back to a stale selection is worse than coming back
to none. An opened Habit history is on the restored side of that line for a reason of its own: a
collapsed run is folded on *every* load, so forgetting the expansion would undo the only gesture
that opens it, where forgetting a collapse merely shows something again. A restored subtree root whose node no longer exists falls back to the true root rather than
leaving a tab rooted at nothing. A session saved before tabs existed comes back as a single tab
carrying its view, orientation and filters.

**A strip per window.** Every window is a tab strip, so the stored strip is **one key per window**,
named after that window's label: `arlesh-window:<label>`. Every window shares one browser store —
they are webviews on one origin — so a single key would have the second window overwriting the
first's tabs. A key each rather than one key holding them all, because a key each is the only shape
in which a window writes down *only its own*: read-modify-write on a shared key is a lost update
the moment two windows are edited at once, and two windows being used at once is the whole point.

The **list of windows** is deliberately not stored beside the strips; it belongs to the backend, for
the reason given under [Windows & Tray](window-tray.md). A window whose label the backend no longer
knows leaves its strip behind, and those are swept at startup by the first window — which is safe
because every window of a session is reopened before any of them runs a line of frontend code, so a
stored label with no window at that moment is a window that really went.

A strip written down before there were windows — under the old single key — is read once, as **the
first window's**, and then left alone. It is the strip the only window a pre-windows session ever
had was showing, and it opens in the window that would have had it. A torn-off window with no
stored strip of its own starts fresh rather than borrowing somebody else's.

**Tearing a tab off.** Dragging a tab **out of the strip** takes it into a window of its own — the
browser gesture, and the one most people will reach for. A drag that ends inside the strip is a
reorder, and a drag that ends on the strip's empty space is a drag that went nowhere; only a drag
that ends outside the strip's rectangle tears off. That last condition is also what makes the
failure safe: a platform that reports no position for the end of a drag hands the app `(0, 0)`,
which is inside the strip, so the gesture reads as "went nowhere" and no window appears. A tear-off
that did not happen costs one more attempt; a window that appears from a drag nobody made is a
window to go and close.

The tab menu offers **Move tab to new window** as well, for anyone who would rather not drag, and it
is absent when the tab is the window's only one — tearing off the only tab would move the window
rather than divide it.

**Moving a tab back** is the menu alone: **Move tab to "…"**, one entry per other open window, named
by what that window's active tab is called. A drag cannot do it. An HTML drag is captured by the
window it began in, and no other window hears about it — so a gesture that looked symmetrical would
work in one direction and silently fail in the other, which is worse than a gesture that is honestly
asymmetrical. Each window is named by its active tab because that is the one thing about another
window the user can see from here: a window's label is a UUID and a window has no title of its own.

The tab travels as the same thing it is stored as, so a tab that moves and a tab that comes back
after a restart are one tab arriving by two routes. Tearing off writes it to the new window's key
*before* asking for the window, so the window finds its tab on boot and nothing travels through an
event that could arrive before the window listening for it does; a window that fails to open gives
the tab straight back. Moving to an existing window sends it first and removes it second, so a
hand-over that never arrives leaves the tab exactly where it was.
