# Tabs

*One area of the [Arlesh design specification](../../SPEC.md).*

Arlesh holds several places on the board open at once. A **tab** owns everything about a view of
the board — its **subtree root**, which of the views it shows, its branch orientation, the scope
kind its [Plan](plan-view.md) pass fills,
its whole Mindmap filter set, its whole List View filter set, its selection, its collapsed nodes,
the Habit histories it has opened and its pan/zoom — and switching tabs swaps all of it at once. "What is left in Bugfixes" and "what am I
doing today" are two different subtrees under two different presets, and a tab each is how both are
held. Nothing a tab owns is reachable from another tab: exiting a subtree, changing a preset or
collapsing a branch in one leaves every other exactly where it was.

**Theme and the clipboard are app-wide**, along with the Undo/Redo stacks and the display
preferences in the settings popover. The clipboard deliberately so — cutting a subtree in one tab
and pasting it in another is the obvious thing to want from a second tab, and nothing about a
clipboard is specific to where it was filled. The theme likewise: the app must not change
appearance as you move between tabs. The branch axis is per tab, because a wide subtree may want to
be vertical while another stays horizontal; how much Habit history folds and whether asynchronous
work leads a run are not, because they are matters of taste about how a board reads, the way the
theme is.

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

**Switching views.** Each view has a chord of its own — `Ctrl+M` for the Mindmap, `Ctrl+L` for the
List and `Ctrl+P` for the [Plan View](plan-view.md) — rather than one chord that cycles. Every view
is then one press from any other, there is no cycle order to learn, and a new view costs one binding
rather than a re-think. `Ctrl+S` is **held for the Steps View** and deliberately left unbound, so
that view inherits the scheme rather than re-opening it.

The switcher sits on **`Ctrl`** because `Alt` was already spoken for: `Alt+A/P/S/D/B` have been the
All/Plan/Start/Do/Backlog status presets since the presets shipped, in every view's own table. Those
tables are dispatched by their own listener, separate from this one, so a view chord sharing a
preset's letter would fire **both** actions on one press — `preventDefault` on the first listener
does not reach the second, and nothing orders them. Moving the views was the cheaper side of that:
the presets keep letters people already have in their fingers. The cost is `Alt+L`, which used to
toggle Mindmap ↔ List and no longer does anything; it was changing regardless, since a two-way
toggle has no meaning once there are three views.

`Ctrl+P` and `Ctrl+S` are webview defaults (print, save) and Arlesh takes them exactly as it already
takes `Ctrl+W` and `Ctrl+T` — the dispatcher reads the event in the capture phase and calls
`preventDefault`, and Arlesh declares no native menu accelerator that would claim them first. Inside
a text field nothing reaches the switcher at all, because the dispatcher ignores events from a
typing target, so a save reflex in a rename box stays a save reflex that does nothing.

Unlike the tab shortcuts below, the three view chords are **suppressed while a modal or an inline
editor holds the keyboard**: switching tabs is never ambiguous about what it acts on, where
switching views behind an open editor would leave that editor over a board it no longer belongs to.

**What is a global binding, and what is not.** A chord belongs in the global table when what it
acts on belongs to the **tab** rather than to the view drawing it. On that rule these are global,
declared once and listed once on the cheat-sheet: the three view chords above; `Ctrl+Escape` and
`Shift+Escape`, which leave a subtree — and the subtree root is the tab's, shared by every view;
`Ctrl+O`, which searches every node and re-roots the tab at the one you pick; and `Alt+F`, which
opens the filter popover over the tab's own filter set. Each of them used to be declared once per
view with an identical chord and an identical action, which meant the cheat-sheet printed it once
per view and each new view added another copy.

They carry the input-capture guard, unlike `Ctrl+Q` and `Ctrl+Shift+/`: as view bindings they were
suppressed whenever a modal or an inline rename held the keyboard, and keeping that is what makes
the promotion a move rather than a change. The cheat-sheet's own chord stays unguarded on purpose,
since it is what closes the cheat-sheet again.

Three families look promotable and are deliberately **not**, and the reasons are worth keeping so
they are not re-litigated:

- **Bare `Escape`** deselects, and only a view knows its own selection. The two modified Escapes
  above are a different question — where the *tab* is rooted — which is why they separate cleanly.
- **Bare `F`** shows the board alone, but the same key converts a node to a Flow on the Mindmap and
  is only eligible when nothing is selected. It is genuinely contested per view; `F11` is the global
  half of it.
- **`Alt+A/P/S/D/B`**, the status presets, write to the shared filter and look identical — but the
  List View's handler also writes that view's **own** preset, which is how any of the five takes the
  list back out of **Unblock**. A single global handler would silently drop that half, and `Alt+U`
  is List-only besides, so the set is not even symmetric.

**Undo and redo** (`Ctrl+Z`, `Ctrl+Shift+Z`, `Ctrl+Y`) are identical in all three views and would
belong here on the rule above, but they are blocked on something else: the handler needs the board
reload, and each view owns its own. They stay per view until the loaded board is tab-level state.

**Persistence.** The tab list, its order, which tab was active, any name a tab was given, and each
tab's subtree root, view, orientation, Plan scope kind, both filter sets and opened Habit histories
are restored on reopening. A stored view this build does not recognise falls back to the default
rather than leaving the tab rendering nothing. A strip
written down before tabs could be named comes back as tabs with no names, labelled as they were. Selection, collapsed nodes and pan/zoom
are **not**: they are working state, and coming back to a stale selection is worse than coming back
to none. An opened Habit history is on the restored side of that line for a reason of its own: a
collapsed run is folded on *every* load, so forgetting the expansion would undo the only gesture
that opens it, where forgetting a collapse merely shows something again. A restored subtree root whose node no longer exists falls back to the true root rather than
leaving a tab rooted at nothing. A session saved before tabs existed comes back as a single tab
carrying its view, orientation and filters.

Tearing a tab off into its own window — and anything else multi-window — is a separate piece of
work and is not described here.
