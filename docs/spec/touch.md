# Phone Layout & Touch

*One area of the [Arlesh design specification](../../SPEC.md).*

Arlesh is going to run on an Android phone (Client mode only; see [HTTP Server](http-api.md)). This
area is the frontend half of that: how the app lays itself out on a narrow screen, and how it is
driven with fingers. It is not Android-only. Everything here also applies to a narrow desktop
window and to a desktop touch screen, because it keys on the **width** and the **pointer**, never
on the operating system.

Designed with the user gesture by gesture on 2026-10-30/31 (Task 201), partly on the phone against
a clickable mock. Layout "D" of that mock is the one chosen; where the mock's gestures disagree with
this page, this page wins.

## Three independent axes

| Axis | Detected by | What it switches |
| --- | --- | --- |
| **Width** | the window is narrower than **700 px** (`(max-width: 699.98px)`) | the [phone layout](#the-phone-layout) |
| **Touch** | a touchscreen is present (`(any-pointer: coarse)`) | the [gestures](#gestures) |
| **Touch only** | touch is the only pointer (`(any-pointer: coarse)` and not `(any-pointer: fine)`) | the [action bar](#the-action-bar), even at desktop width |

They are independent: a narrow desktop window gets the phone layout and keeps the mouse; a touch
laptop at full width keeps the desktop layout and gains the gestures; a phone gets all three.
Detection is a media query read through a hook (`use-media-query.ts`), so it follows a window being
resized or a keyboard being docked without a reload. Nothing here depends on Tauri's mobile APIs.

## The phone layout

Below 700 px:

- **Bottom navigation** for the views, in this order: **Zen, List, Plan, Steps, Map**. It replaces
  the top bar's view selector. `Ctrl+M/L/P/S/J` still switch views from a keyboard.
- **The top bar** holds, in order: a **☰ menu**, the **title**, the **preset chip** and the agents'
  status. The title is the view's name at the board's root, and the breadcrumb inside a subtree.
  The server status joins it when Client mode lands (Task 9f0).
  - **The preset chip** shows the preset the view reads under and opens the **preset sheet**: Plan,
    Start, Do, Backlog and All, plus the List View's Unblock and Expectations while the List View is
    showing. In the Plan View and the Zen View the chip shows their locked preset and the sheet says
    why the others are unavailable, as the desktop control's disabled options do.
  - **The ☰ menu** holds what the desktop top bar has beyond the view and preset: Filter (the menu,
    as a sheet), the Plan preset's scope while Plan is chosen, the command palette, Settings and the
    keyboard sheet.
- **The filter chips** stay under the top bar and wrap.
- **The context [action bar](#the-action-bar)** sits above the bottom navigation.
- **Sheets instead of modals and popovers.** Every editor and every full dialog (the node editors,
  the searches, Settings, the keyboard sheet) fills the screen; every popover and confirmation (the
  quick pickers, the Filter menu, the context menus, the delete and warning prompts, the app's
  dropdowns) rises from the bottom as a sheet. They keep their content and their keys; only where
  they are drawn changes.
- **List rows take two lines**: the title on the first, the badges and meta on the second. Path
  headers stick to the top while their rows scroll beneath.
- **The Plan View stacks its panes**: candidates on top, the planned pane at the **bottom**, and the
  planned pane draws **no subscope cells** (stepping through them is the scope swipe, below).
- **The Zen View** is a vertical, scrollable list of cards sized to fit, in place of the grid. The
  cards mean what the grid's mean, and act the same.
- **No hover.** A tooltip's text moves into the editor or appears on a tap.
- **Toasts** rise above the action bar rather than covering it.
- **Tabs are not shown** in the phone layout: the tab strip is hidden and the active tab is the one
  shown. The tab chords still work from a keyboard. *(Decided in implementation: the grill excluded
  tabs on Android and did not say what a narrow desktop window does with them; hiding the strip is
  the reversible choice.)*
- **Full screen** (`F11` / `F`) hides the top bar and the chips, as it does on the desktop; the
  bottom navigation and the action bar stay, since they are the only way back on a phone.

## The action bar

A row of buttons above the bottom navigation, chosen by what is selected. It shows in the phone
layout, and on any touch-only device at any width. **Its last slot is always More**, which opens
the [command palette](#the-command-palette).

| Context | Slots (then More) |
| --- | --- |
| Nothing selected | New, Undo, Redo, Search/jump, Filter (`Ctrl+F`) |
| A Task | Status cycle, Child, Plan (`P`), Dependency (`d`), Open (`Ctrl+O`) |
| A Commitment | Verdict, Child, Plan, Open |
| A wait | Release, Check done, Child, Open |
| A Goal, Domain or Project | Child, Sibling, Edit, Open |
| A Flow or Habit | Start Flow, Item, Edit, Open |
| Several selected | Status, Plan, Archive, Undo |
| The Plan View | Plan into the shown scope, Kind (S/M/W/D/P), Backlog candidates, Filter |

**Undo and Redo fill the free slots**: a context with fewer than five slots gains Undo, then Redo,
before More. Where there is no room they are in the palette.

Every slot **runs a binding of the [hotkey registry](#one-registry)** — the same guard, the same
handler and the same refusal toast the key has — so a slot cannot do something the key does not.
A slot whose binding cannot act in the current state is drawn disabled, never hidden, so the bar
does not jump about. Two slots have no key of their own and are touch commands a view registers
beside its bindings: **New** (a Task under the subtree you are in, refused out loud where a Task
cannot hang) and **Kind**, which opens a sheet of the five scope kinds, each its own binding.

*Open (`Ctrl+O`)* is the node search that re-roots the tab, as the chord is everywhere.
*Archive* and *Check done* have no binding yet; until they do their slots are drawn disabled.

## The command palette

A sheet listing **every binding that can act right now**: generated from the hotkey registry,
filtered to the tables the current view has mounted (the global ones, the tab's, and the view's)
and, through each binding's own guard, to the selection. Each row shows its action and its key.
A search box narrows the list. Choosing a row closes the sheet and runs the binding. A binding that
only gives another one a second key (the numpad zoom, `F2`) is listed once, under the first; a pair
of opposites the cheat-sheet lists on one line (previous and next scope) gets a row each, worded
for its direction.

It is opened by the action bar's **More**, by the ☰ menu, and by a **long-press** on a node.

**No lost control.** `palette-coverage.test.ts` fails if any binding in the registry has neither a
palette entry nor a gesture. A binding is in the palette unless it is listed in the palette's
exclusions with the gesture that replaces it (the arrow keys are replaced by tapping, the Mindmap's
arrow-key pan by dragging the canvas, the List View's `j`/`k` by scrolling); a binding marked
`hidden` (an alias such as `Ctrl+Y`) is covered by the visible binding it duplicates.

**Hotkeys keep working** whenever a keyboard is attached, at any width: the phone layout changes
what is drawn, never what a key does.

**Select** — a toggle in the palette — turns taps into building a multi-selection: while it is on,
a tap adds a node to the selection or takes it out. *(Second PR of the stack.)*

## Gestures

Whenever a touchscreen is present, at any width.

- **Tap** selects. **Tapping the selected node again** deselects it.
- **Long-press** on a node opens the command palette for that node.
- A quick **flick up** on a node opens its editor. Scrolling wins when the move is slow or long.
- **Double-tap** means "go into", everywhere: the Mindmap enters the node; the Steps View steps into
  it; the List View narrows to its subtree (Under); the Plan View opens its subtree; the Zen View
  opens the node in the List View.
- **Swipe a row or a card right** to cycle its status: Done wraps back to To Do, a Commitment moves
  to its next verdict and a wait to released, exactly as the status-cycle key does. **Swipe it
  left** for the `Alt+Enter` alternative, setting Started. There is no swipe tray.
- A **two-finger swipe** left or right cycles the preset.
- **Pinch** zooms in the Mindmap and the Steps View.
- **Undo and redo are buttons**, not gestures.

### Per view

- **Mindmap**: one finger on empty canvas pans. **Hold a node and drag it** to move it under another
  parent or reorder it. **Tap a collapse dot** to fold or unfold.
- **Steps View**: a single tap selects.
- **Plan View**, planned pane: a swipe left or right steps the scope (`[` and `]`), and a swipe
  **up** goes to the parent scope (`\`). **Swipe a candidate right** to plan it into the scope the
  pane shows.

## One registry

The palette, the action bar and the coverage test all read the same tables the keyboard dispatches
from (`src/utils/hotkeys/`). `useHotkeys` publishes each mounted table, with its live context, to
the **command surface** (`use-command-surface-store.ts`); the palette lists what the surface holds
and runs it through the binding's own `run`. Adding a binding therefore adds a palette entry with
no further work, and a binding that should not be in the palette has to name the gesture that
replaces it.
