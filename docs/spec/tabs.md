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

Tearing a tab off into its own window — and anything else multi-window — is a separate piece of
work and is not described here.
