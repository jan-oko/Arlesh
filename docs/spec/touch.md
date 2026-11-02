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
  status, then the [hot square](#the-top-bar-square). The title is **"Arlesh" at the board's
  root** (decided with the user, 2026-11-02: the view's name is not repeated, the bottom
  navigation's highlighted tab says which view this is), and the breadcrumb inside a subtree. **In portrait the breadcrumb is `‹ {current node}`**:
  the chevron **or the current node's name** opens the full path as the `…` of the long form does (a
  menu of every level above, each one exiting to it). The chevron is a transparent touch target of
  at least 40 x 40 px around a glyph the height of a capital letter of the title's font (`1cap`),
  centred on the text (decided with the user, 2026-11-02; round 5 had made it 28 px). Landscape keeps the whole chain. **The path's first
  segment is always "Arlesh"** (the board), in both forms and in the full-path menu, never the name
  of the view.
  There is **no server indicator** on the phone's bar, nor, since round 6 (decided with the user, 2026-11-02), on the desktop's (feedback from a Pixel 10 Pro: it crowded the
  bar); the server's status lives on **Settings → Server** ([Client mode](client-mode.md)).
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
  Settings, the keyboard sheet) fills the screen; every popover and confirmation (the quick pickers,
  the Filter menu, the context menus, the delete and warning prompts, the app's dropdowns) rises from
  the bottom as a sheet. They keep their content and their keys; only where they are drawn changes.
  - **The two searches are not full screen.** *Open* (`Ctrl+O`) and the *Filter* search (`Ctrl+F`)
    are a card under the top edge over a dimmed margin, so the board stays in view and the keyboard
    does not hide the box. A phone has no Escape key, so each is escapable three ways: **Android's
    back**, a **tap outside** the card and a **close button** (✕) beside the search box. The Filter
    menu sheet has the same close button and the same back and outside tap. Back works because it is
    delivered as an Escape to the top dialog, so a dialog must answer an Escape aimed at itself, not
    only one typed in its box.
  - **The text prompt is focused as the modal opens.** *Open*, the *Filter* search and the command
    palette each put the focus in their search box in the same render that draws them, inside the
    gesture that opened them (`autoFocus`, never a timer): Android's webview raises the soft keyboard
    for a focus made then, not after a delay. The sheet's own focus (for Escape) therefore stands
    aside when a field inside already has it. The hot square also cancels the touch that
    opened Open, so the click the browser synthesizes afterwards cannot land on the new overlay,
    close it, or take the focus off the box.
- **List rows take two lines**: the title on the first, the badges and meta on the second. Path
  headers stick to the top while their rows scroll beneath.
- **The Plan View stacks its panes**: candidates on top, the planned pane at the **bottom**, the two
  **sharing the height equally** (50/50; round 1 had given the planned pane a third, which the user
  reverted in round 5). The planned pane can be **split by
  subscope** exactly as on the desktop (user, round 5: "support subscopes as well"): the same
  setting (`planSplitBySubscope`), switched in the same place, the **planned pane's ⋮ menu**. Its
  buckets (a week's days, a month's weeks) are laid out as below; the keyboard hints on the headings are
  hidden. A card is [dragged onto a bucket](#per-view).

  **Decided with the user, 2026-11-02.** The panes split 50/50. The split is the one app-wide
  `planSplitBySubscope`, **on by default**, as on the desktop. Not dragging, the planned pane has two
  modes, chosen by the app-wide setting `planPhoneTabs` (Settings → Plan, and the planned pane's ⋮
  menu beside *Split by subscope*; the menu entry is inert while the split is off):
  - **Tabs** (the default): a row of bucket tabs across the top of the pane, label only (Mon, W40,
    Dec, Morning: the labels the desktop uses), showing **one bucket's cards at a time**. It always
    opens on the first bucket. The chosen tab is kept while the user stays on the same scope and
    reset to the first on a scope change. An empty bucket still gets a tab, and a partial bucket
    carries the desktop's partial mark on its tab.
  - **Stacked**: as on the desktop, one heading per bucket (an empty one as a heading line), all in
    one scrolling column, the heading sticky while its bucket scrolls under it.

  **The drop overlay.** When a drag starts, from either pane, with the split on, an overlay covers the
  **planned pane only** (the bottom half) with **one large tile per bucket**, label only (no dates, no
  counts), in calendar order, laid out as a grid that fills the half-pane: up to 3 in one row, 4 to 6
  in two rows, 7 as 4 + 3. The tile under the finger lights up. **The bucket the dragged card already
  sits in is dimmed, and dropping there cancels.** The to-plan pane stays visible above as the "take
  it back out" target. Lifting anywhere else cancels. A multi-selection carries the whole selection.
  The tiles carry `data-plan-section` and are the drop targets in this mode, in place of the buckets
  underneath (`PlanDropOverlay`). **A swipe on a to-plan card with the split on opens the same overlay
  in pick mode**: tap a tile to place the card there; a tap outside the tiles, Android's back or a tap
  on the dimmed tile cancels. A swipe on a planned card still takes it out to to-plan; with the split
  off, swipes transfer between the panes as before. The desktop is unchanged.
- **The Zen View** is a vertical list of cards in place of the grid that **fills the screen**: the
  cards share the height between the strips and the action bar equally (three cards each take a
  third, one card takes it all), their content centred across and down, and the title scales with
  the card as on the desktop. A card is **never shorter than its content** (the whole title, the
  path and the badges, never clamped): when the cards at that minimum do not fit, the column
  scrolls. The cards mean what the grid's mean, and act the same. "Never clamped" holds for the
  path too, and for the Commitment and Wait chips above the list: on the phone the path wraps and a
  chip's title takes as many lines as it needs, rather than ending in an ellipsis.
- **The Steps View** lays its cards out one of two ways, chosen under **Settings > Steps** ("Fill
  the screen on the phone", app-wide, phone layout only; the desktop grid is unaffected):
  - **Fill the screen** (the default, as the Zen View does): one column of every card, **never
    paged** (user, 2026-11-02: where the phone paginated, it scrolls). The cards share the area's
    height equally and fill their cells, but none is shorter than the zoom's card height; when
    they no longer fit at that height the column scrolls. A lone card fills the area. The desktop
    grid still pages.
  - **Scroll**: one scrolling column in place of the paged grid, each card as tall as its content
    (its Info notes up to a cap). There is no page to turn, and the zoom no longer sets the card.
- **No hover.** A tooltip's text moves into the editor or appears on a tap.
- **Toasts** rise above the action bar rather than covering it.
- **Tabs are not shown** in the phone layout: the tab strip is hidden and the active tab is the one
  shown. The tab chords still work from a keyboard. *(Decided in implementation: the grill excluded
  tabs on Android and did not say what a narrow desktop window does with them; hiding the strip is
  the reversible choice.)*
- **Full screen** (`F11` / `F`, or a **three-finger tap** anywhere in a view) hides the top bar and
  the chips, as it does on the desktop, **and the action bar and bottom navigation too** (user,
  round 5; they used to stay as the way back). All that remains is the [hot
  square](#the-top-bar-square) fixed in the **bottom-right corner** (`ActiveTab` draws
  `TopBarSquare corner`, the very component of the top bar, so it behaves the same: tap opens
  Open, long-press opens the palette, whose Full screen command, like the three-finger tap, is the
  way out). Because the action bar's Edit is gone with it, the [quick action menu](#gestures) has
  Edit. The square is drawn faint (70% opacity, a translucent fill) over the board's corner and is
  fixed above content, clear of the system gesture bar.

### Back at the root, and small phone fixes

All decided with the user, 2026-11-02.

- **Back at the root asks "Quit Arlesh?"** (decided with the user, 2026-11-02). Android's back closes a sheet, leaves
  a stepped-into node or goes up a scope first, as before; only when none applies (`stepBack`'s
  `exit`) it opens a confirm dialog with **Quit** and **Cancel** instead of leaving at once. Back
  again, or Cancel, stays; Quit calls the same `quitApp` as `Ctrl+Q`. The dialog is a
  `role="dialog"` (the shared `WarningConfirmModal`, which now answers Escape), which is why the
  next back reaches it through `dismissTopSheet` like any sheet.
- **The cheat sheet has a ✕ close button** (decided with the user, 2026-11-02) on the phone, in its title row, as the Open and Filter
  sheets have.
- **Settings help tips stay inside the screen** (decided with the user, 2026-11-02). `HelpTip`'s bubble is fixed to the viewport and
  placed from the room around its mark (`bubblePlacement`): at most 280 px wide and never wider than
  the viewport minus an 8 px gutter each side, shifted left or right to fit, under the mark or above
  it where the room below is the smaller; the text wraps. A tap on the mark shows and hides it, as
  hover and focus do on a desktop.

### The top bar square

**The hot square** (the user's name for it) is the free square on the top bar and, in fullscreen,
the one in the bottom-right corner; both behave the same.

The last cell of the top bar is left **free**: a 36 px dashed square with nothing in it. A
**tap** on it opens **Open** (`Ctrl+O`'s node search), and a **long-press** opens the
[command palette](#the-command-palette) **the moment the long-press time (500 ms) is reached, while
the finger is still down** (user, round 5; it used to wait for the lift). The lift that follows does
nothing: it is no tap, its synthesized click is cancelled, and it does not close the palette. The
palette's input takes the focus as it mounts, inside the hold's timer callback, so the keyboard
rises. (A first build
asked for a double-tap; on the device that read as a dead square, so one tap does it.) It is where
a thumb rests, and it keeps Open off the action bar when a node is selected.

A **tap** is a press and a lift on the square within a slop of 10 px (`TAP_SLOP_PX`) and under the
long-press time. The slop is measured by distance, never by leaving the square, and the square
sets `touch-action: none` and captures its pointer: otherwise Android takes a thumb's few px of
roll for a pan and cancels the pointer, and the tap is lost (user, 2026-11-02: it "doesn't work
consistently").

## System bars

Decided with the user, 2026-11-02: how the app sits against the Android system bars is a **three-way
choice**, set separately for normal display and for fullscreen. Two selects under Settings >
General (`systemBars`, `systemBarsFullscreen`), shown on Android or in the phone layout only; the
desktop window is unaffected. **Defaults: Edge-to-edge in normal display, Immersive in fullscreen.**
Fullscreen is the app's own chrome hiding (see [Full screen](#the-phone-layout)); leaving it
restores the normal display's mode.

| Mode | Bars | The app | Inset variables |
| --- | --- | --- | --- |
| Standard | visible, opaque | starts below the status bar; the activity pads the view | 0 |
| Edge-to-edge | visible, transparent | drawn under them, padded by the page | the real insets (bars and cutout) |
| Immersive | hidden; a swipe from the edge shows them for a moment | the whole screen; the content does not move when they peek | the cutout only |

- **Insets.** `MainActivity` measures the real insets (`systemBars()` plus `displayCutout()`),
  converts them to CSS pixels and writes them to the page's `--sat`, `--sab`, `--sal`, `--sar` on
  every inset change; the page asks again whenever its mode changes or it loads. The CSS never
  reads them directly: `tokens.css` defines `--safe-top` and its three siblings as
  `max(env(safe-area-inset-*), var(--sat…))`, because Android's WebView does not report `env()`
  reliably. The top bar pads its content by `--safe-top` while its background runs under the status
  bar; the bottom bars, sheets and fullscreen's hot square sit above `--safe-bottom`. With the
  soft keyboard up, the activity pads by the keyboard and the bottom inset is 0.
- **Standard** is the classic layout. It is implemented by padding the view rather than by turning
  the window's fitting back on, which Android 15 enforces off; the bars' colour is the view's
  background (black-ish on the dark theme, white on the light one) showing through the padding.
- **Immersive** hides the bars with `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`.
- **Full screen pads the views for the bars** (decided with the user, 2026-11-02, from phone screenshots:
  the List's first heading and the Plan header sat under the status bar). Full screen removes the top
  bar and the bottom bars, so every view but the Mindmap pads its content box: at the top by the status
  bar only, with no extra gap above the first content (decided with the user, 2026-11-02), at the bottom by the gesture bar. Edge-to-edge uses the visible insets
  (`--safe-top`, `--safe-bottom`); Immersive uses where the hidden bars peek, `--peek-top` and
  `--peek-bottom`, which `MainActivity` pushes from `getInsetsIgnoringVisibility(systemBars())`
  (fallbacks 28 px and 24 px). `useSystemBars` marks the root `data-fs-bars="edgeToEdge"|"immersive"`
  in full screen (never for Standard, which the activity pads, nor without the bridge), and
  `tokens.css` turns that into `--peek-pad-top` and `--peek-pad-bottom` (both 0 otherwise).
  The List has no top padding of its own (a sticky box sticks at the content edge, which a padding
  would push down): an opaque sticky `::before` mask as high as `--peek-pad-top` sits over the scroll,
  and the phone's sticky path headers stick at `top: var(--peek-pad-top)`, flush under it, so nothing
  scrolls visibly above a stuck header and a peeking status bar covers only the mask. The Mindmap stays full-bleed: the canvas can be panned. Outside full screen the top bar and bottom
  navigation already pad by the visible insets.
- **The fullscreen hot square** sits at `max(0.3 x radius + 12px, safe inset + 12px, 20px)` from the
  right edge, and from the bottom `max(0.3 x radius + 12px, safe inset + 12px, peek pad + 12px,
  20px)`: at least 20 px clear of both edges, the gesture bar's peek included (decided with the user,
  2026-11-02). It is semi-transparent and may overlap content; no padding is reserved for it (decided
  with the user, 2026-11-02).
- **The bridge.** The web side states the wanted mode and the theme (`useSystemBars`: the normal or
  the fullscreen setting, by whether the app is in fullscreen) through
  `window.ArleshBars.setSystemBars(mode, dark)`, a `@JavascriptInterface` (`SystemBarsBridge.kt`; R8
  keep rule in `proguard-rules.pro`). A JS interface, not a Tauri command, because nothing in Rust
  needs the call. The status and navigation bar icons are light on the dark theme.

## The action bar

A row of buttons above the bottom navigation, chosen by what is selected. It shows in the phone
layout, and on any touch-only device at any width. **Its last slot is always More**, which opens
the [command palette](#the-command-palette).

| Context | Slots (then More) |
| --- | --- |
| Nothing selected | Up, Undo, Redo, Open, Filter |
| A Task | Status, Child, Plan (`P`), Dependency (`d`), Edit (`E`) |
| A Commitment | Verdict, Child, Plan, Edit, then Undo |
| A wait | Release, Check done, Child, Edit, then Undo |
| A Goal, Domain or Project | Child, Sibling, Edit, then Undo and Redo |
| A Flow or Habit | Start, Child, Edit, then Undo and Redo |
| Several selected | Status, Plan, Archive, Undo, Redo |
| The Plan View | Plan in (the shown scope), Kind (S/M/W/D/P), Backlog candidates, Filter, Edit |

**Edit is on the bar in every view**, wherever a node can be selected (drawn disabled while nothing
is). **Undo and Redo fill the free slots**: a context with fewer than five slots gains Undo, then
Redo, before More. Where there is no room they are in the palette.

### One vocabulary, one icon set

*Decided 2026-11-01 from the phone test, which found "New" beside "Child" and "Search" beside
"Open" for what were the same things.* The bar, the palette and the cheat sheet use these words and
no others for these actions:

| Word | Means | Replaces |
| --- | --- | --- |
| **Child** | create a Task (or a Flow's item) under the selection; with nothing selected, under the subtree you are in | New, Item |
| **Sibling** | create a node beside the selection | |
| **Open** | `Ctrl+O`: search by title and go into the node | Search, Search/jump |
| **Filter** | `Ctrl+F`: search the filters and add one | |
| **Status** | cycle the selection's status (Verdict and Release are its names for a Commitment and a wait) | |
| **Dependency** | the quick dependency picker | Depends |
| **Edit** | open the editor | |
| **Up** | `Shift+Escape`: leave the entered subtree one level (the breadcrumb's parent step); greyed at the top level. Shown with nothing selected, where it replaced Child (user, round 5); the two-finger swipe up does it too | |

*Rationale:* the desktop already says "child" and "sibling" (`createChild`, `createSibling`) and
`Ctrl+O` is *Open*, so the touch words follow the desktop's and the two words that were doubled
are dropped. "Search" is left to text boxes. The desktop's two search labels (`openSearch`,
`openFilterSearch`) now read "Open a node: …" and "Filter: …".

**A long-press on Child** opens a sheet to pick the new child's **kind** (user, round 5); a tap stays
a Task. The sheet lists the kinds the selected node can parent, by the rule creating and re-parenting
share (`childKindsFor`, over `isValidDropTarget`), and a pick runs the desktop's typed-child chord for
it (`mindmap.createTypedChild.<kind>`, with `Tab` for a Task), so every refusal is the chord's. Only
the Mindmap publishes the typed chords; in the List and Steps Views, which create Tasks and nothing
else, the sheet offers Task alone.

**Open is on the bar only with nothing selected**; with a node selected it is the top bar's free
square (tap) and the palette, which frees the slot Edit needs.

**The icon set** (`ActionIcon`) is outlined, 24 x 24, a 1.8 stroke with round caps and joins, no
fills, `currentColor`: the drawing style of `StatusIcons` and `NodeIcon`. One icon per action, the
same in the bar and in the palette's rows (the palette takes it from the bar slot that runs the same
binding, `iconForCommand`). **Filter** is a funnel. **Status** is the Started Task's own glyph
(`TaskIcon`, the ring with an unfilled centre), the state it moves a Task to. The Steps View's
staircase in the bottom navigation is drawn in this style too: the bottom navigation takes all five
of its view icons from the set (a target, a list, four panes, the staircase and a fork).

Every slot **runs a binding of the [hotkey registry](#one-registry)** — the same guard, the same
handler and the same refusal toast the key has — so a slot cannot do something the key does not.
A slot whose binding cannot act in the current state is drawn disabled, never hidden, so the bar
does not jump about. Two slots have no key of their own and are touch commands a view registers
beside its bindings: **Child with nothing selected** (a Task under the subtree you are in, refused out loud where a Task
cannot hang; it is in the palette, no longer on the bar) and **Kind**, which opens a sheet of the five scope kinds, each its own binding.
Two more are touch commands for the same reason: **Check done** (on a wait, completes its
earliest-due open check task) and **Archive** (on a selection, puts away every node that takes the
hand archive — a stored Task or Commitment, or a Domain — and **brings them all back** when every
one is already archived). Archive is **one gesture**, one transaction and one undo step, run
through the `archive-nodes` gesture operation of [Client mode](client-mode.md#undo), which admits
the three updates it is made of. A selected node with no archive of its own is left as it was and
a toast says how many.

**A read-only board.** In Client mode, while the server is unreachable or speaks another API
version, the board is read-only ([Client mode](client-mode.md#offline)). Every touch surface greys
out its writes instead of letting them fail: the action bar draws the write slots disabled, the
palette lists the writes as unavailable, and the write gestures — a swipe's advance or Started, a
Plan View swipe's move across or back, the Mindmap's hold-and-drag — do nothing. What only reads stays:
moving the selection, the presets and filters, search, zoom, folding, the tab chords, opening an
editor. `utils/touch/writes.ts` says which commands only read; anything it does not list is taken
to write, so a new binding is greyed out until someone says it reads.

## The command palette

A sheet listing **every binding that can act right now**: generated from the hotkey registry,
filtered to the tables the current view has mounted (the global ones, the tab's, and the view's)
and, through each binding's own guard, to the selection. Each row shows its action and its key.
A search box narrows the list. Choosing a row closes the sheet and runs the binding. A binding that
only gives another one a second key (the numpad zoom, `F2`) is listed once, under the first; a pair
of opposites the cheat-sheet lists on one line (previous and next scope) gets a row each, worded
for its direction.

It is opened by the action bar's **More**, by the ☰ menu, and by a **long-press on the hot square** ([below](#the-top-bar-square)). A long-press on a node opens that node's quick action menu, not the palette.

**No lost control.** `palette-coverage.test.ts` fails if any binding in the registry has neither a
palette entry nor a gesture. A binding is in the palette unless it is listed in the palette's
exclusions with the gesture that replaces it (the arrow keys are replaced by tapping, the Mindmap's
arrow-key pan by dragging the canvas, the List View's `j`/`k` by scrolling); a binding marked
`hidden` (an alias such as `Ctrl+Y`) is covered by the visible binding it duplicates.

**Hotkeys keep working** whenever a keyboard is attached, at any width: the phone layout changes
what is drawn, never what a key does.

**Select** — a toggle in the palette — turns taps into building a multi-selection: while it is on,
a tap adds a node to the selection or takes it out. It is offered where a view holds several (the
Mindmap and the Plan View), and switching views turns it off.

## Gestures

Whenever a touchscreen is present, at any width.

- **Tap** selects. **Tapping the selected node again** deselects it.
- **Long-press** on a node opens that node's **quick action menu** (not the command palette; the
  palette is the [hot square](#the-top-bar-square)'s long-press and the action bar's More).
  The menu has **Edit** on every node, in the Mindmap's menu and the List View's row menu (user,
  round 5): full screen hides the action bar's Edit, and one consistent menu is simpler than one
  that changes with the mode. Edit selects the node and runs the editor binding. The List's row menu
  now opens on every row (it used to open only where the archive applied).
- A quick **flick up** on a node opens its editor. Scrolling wins when the move is slow or long.
- **Tap a node's status icon** to step its status, exactly as the status-cycle key does (a
  Commitment's icon its verdict, a wait's its release). The tap **selects the node** and steps it,
  and a second quick tap does not open its editor. The icon is a control of its
  own on every card (the List's rows, the Zen and Steps cards, the Zen strips, the Mindmap's node);
  on the phone the Zen card always draws it, so there is always something to tap. The Plan View's
  cards have no status step to run, so their icon stays a picture.
- **Double-tap** means "go into", everywhere: the Mindmap enters the node; the Steps View steps into
  it; the List View and the Plan View **enter its subtree**; the Zen View enters it and shows it in
  the List View. **Entering is entering the subtree** — the tab's subtree root, named in the
  breadcrumb, which leads back up — never a filter: no Under pill is added (user, 2026-11-02). In
  every view **except the Mindmap**, a node with **nothing beneath it** has no subtree to enter, so
  its double-tap opens its editor instead; the Mindmap may still enter a leaf.
- **Swipe a row or a card right** to cycle its status: Done wraps back to To Do, a Commitment moves
  to its next verdict and a wait to released, exactly as the status-cycle key does. **Swipe it
  left** for the `Alt+Enter` alternative, setting Started. There is no swipe tray.
- A **two-finger swipe** left or right cycles the preset.
- A **two-finger swipe up** does **Up** (below): out of the entered subtree one level, as the
  breadcrumb's parent step; at the top level it does nothing. A **three-finger tap** toggles
  [full screen](#the-phone-layout). The two-finger swipe lives in the shared gesture layer
  (`useTouchGestures`, armed by `useViewGestures`); the three-finger tap is read on the whole
  document (`useThreeFingerTap`, armed in `App`), so both work in every view, and the tap over the
  bars and over a sheet or menu too. **Multi-finger touches never fire a
  one-finger gesture**: the second finger cancels whatever the first began (no tap, hold, swipe or
  drag), and the touch is read only when the last finger lifts. **Against pinch-zoom** (the Mindmap's
  and the Steps View's) the two-finger swipe up needs the fingers to keep their spread (within 40 px)
  while moving at least 80 px, mostly vertically; a pinch changes the spread and is not an Up, and a
  swipe that is also a slight pinch zooms by that slight amount at most.
- **Pinch** zooms in the Mindmap and the Steps View.
- **Undo and redo are buttons**, not gestures.

Each gesture acts by selecting the node and running the binding its key would run (`E`, `Enter`,
`Alt+Enter`, `Enter` in the Plan View), through the same command surface as the action bar — the same
guard and the same refusal. A touch that starts on a field, or on a control of its own (a status
button, a tag pill, a collapse dot), is left to that control.

*Decided in implementation, where the grill was silent:*

- **A long-press selects the node when the finger lifts**, with a short vibration at the moment the
  hold registers; the quick action menu is the webview's own `contextmenu` for that hold, handled
  by the node. (An earlier build also opened the palette on lift, so one hold opened two things.)
  Holding then moving is what lets the Mindmap's hold-and-drag start from the same hold.
- **The tap that deselects waits out the double-tap window** (300 ms), so a double-tap on the
  selected node goes into it without deselecting it on the way. A tap on an unselected node selects
  at once.
- **The Zen View's "open in List"** switches to the List View narrowed Under the card, the List
  View's own double-tap.
- **The Plan View has no scope swipe.** An earlier build stepped the scope with a sideways swipe on
  the planned pane and climbed to the parent with a swipe up; the header's buttons do that now, and a
  flick up on a planned card opens its editor like any other.
- **The two-finger swipe** turns the same way: left to the next preset, right to the previous. In
  the Plan and Zen Views, which lock their preset, it says why.
- **The Mindmap's collapse dot** is drawn on every node with children on a touchscreen — filled
  while folded, hollow while open — with a fingertip-sized hit area.

### Per view

- **Mindmap**: one finger on empty canvas pans. **Hold a node and drag it** to move it under another
  parent or reorder it. **Tap a collapse dot** to fold or unfold.
- **Steps View**: a single tap selects; a tap on a card's glyph selects it and steps its status.
- **Plan View**: a swipe moves a card across the panes, **either way** (user, round 5). **Swipe a
  to-plan card left or right** to plan it into the scope the pane shows; **swipe a planned card left
  or right** to take it out again (the pane's take-out, the same move as its `←` button and the
  desktop's key), which lands it back in the to-plan pane. The card flies out in the direction it was
  swiped. In the Plan View a swipe is therefore never a row's advance or Started; a card that cannot
  cross (no take-out target) swipes as any row. With the planned pane split into buckets there is no
  "the scope itself" to plan a to-plan card into, so on the phone its swipe opens the drop overlay's
  tiles in pick mode (see *The Plan View stacks its panes*) instead of moving it. A vertical swipe is the flick up, the editor's. The acting card is
  selected first, like every other per-node action. Both directions run the same
  `planView.moveAcross` command (`usePlanMove`); only the gesture mapping in `PlanView` changed.
  **Hold a card, then drag** it (the Mindmap's hold-and-drag, from `useTouchGestures`' `holdDrag`;
  `usePlanTouchDrag`): onto the **other pane** to move it across, or, with the split planned pane, onto a **tile** of the drop overlay that covers it while the drag lasts, to plan it into that subscope. A hold released without moving is the long-press, as
  everywhere. The drag carries the selection when the card is selected, else selects the card first;
  a chip with the card's title follows the finger; the target under it is outlined as on the
  desktop (a split pane takes drops only on its buckets). The drop goes through the desktop's drop
  path (`dropRows`, then `planView.moveAcross` / `usePlanMove`). While the finger rests within 48 px
  of a list's top or bottom edge that list scrolls, so a bucket out of view can be reached. On a
  touch-only device the cards are not natively `draggable`, so the browser's own long-press drag
  cannot steal the touch; the drag's first move cancels the scroll it would have started.

**The swipe follows the finger.** While a card that will cross is dragged sideways it moves with
the finger (`translateX`). Letting go past 60 px (the swipe's own minimum) slides it the rest of the
way out in the swipe's direction over 180 ms, and then the move fires; letting go short springs it
back and nothing happens. A card whose swipe leaves it in place (a row's advance, Started) only
nudges, at most 96 px. With `prefers-reduced-motion` nothing slides: the move fires on release, or
is cancelled. If the move leaves the card where it was (refused), it springs back after 600 ms.
This is `useTouchGestures`' `flysOut` handler and `utils/touch/swipe-slide.ts`; any view whose swipe
moves a card can adopt it.

### The gesture list, and the cheat sheet

On a device whose only pointer is touch (`(any-pointer: coarse)` and not `(any-pointer: fine)`), the
cheat sheet (☰ menu → Gestures there, Keyboard shortcuts elsewhere) **shows the gestures instead
of the keyboard shortcuts**:
one tab for the gestures everywhere and one per view, opening on the view it was opened over. With a
mouse or trackpad present it shows the shortcuts as ever. The list is one place in code,
`utils/touch/gesture-list.ts`; **this table mirrors it row for row**, and `gesture-list.test.ts`
fails when the two differ, so a gesture is added to both or to neither.

| Where | Gesture | Does |
| --- | --- | --- |
| Everywhere | Tap | Selects the node; tapping the selected node again deselects it |
| Everywhere | Tap a status icon | Selects the node and steps its status, as Enter does |
| Everywhere | Double-tap | Goes into the node (the Mindmap enters a leaf too; elsewhere a node with nothing beneath it opens its editor); what that means is each view's, below |
| Everywhere | Long-press | Opens the node's quick action menu |
| Everywhere | Flick up | Opens the node's editor |
| Everywhere | Swipe right | Advances the status: a Task's, a Commitment's verdict, a wait's release |
| Everywhere | Swipe left | Sets Started |
| Everywhere | Two-finger swipe | Left shows the next preset, right the previous |
| Everywhere | Two-finger swipe up | Goes up one level out of the entered subtree, as Up does |
| Everywhere | Three-finger tap | Turns full screen on or off |
| Everywhere | Long-press Child on the action bar | Picks the kind of the new child: Task, Goal, Commitment, Info and so on |
| Everywhere | Tap the hot square | Opens Open, the node search |
| Everywhere | Long-press the hot square | Opens the command palette |
| Mindmap | Double-tap a node | Enters its subtree |
| Mindmap | Drag the canvas | Pans the map |
| Mindmap | Hold a node, then drag | Moves it under another parent or reorders it |
| Mindmap | Tap a collapse dot | Folds or unfolds the node's children |
| Mindmap | Pinch | Zooms the map |
| List | Double-tap a row with nothing beneath it | Opens its editor |
| List | Double-tap a parent | Enters its subtree; the breadcrumb leads back up |
| Plan | Swipe a to-plan item either way | Slides it out the way you swiped and plans it into the scope; with the planned pane split by subscope, opens a tile for each subscope to tap |
| Plan | Swipe a planned item either way | Slides it out the way you swiped and moves it back to the to-plan pane |
| Plan | Hold a card, then drag | Carries it to the other pane, or, with the planned pane split by subscope, onto one of the tiles that cover that pane while you drag, to plan it into that subscope |
| Plan | Double-tap a card | Enters its subtree, or opens its editor when it has nothing beneath it |
| Steps | Double-tap a card | Steps into it, or opens its editor when it has nothing beneath it |
| Steps | Pinch | Zooms the steps |
| Zen | Double-tap a card | Enters its subtree in the List View, or opens its editor when it has nothing beneath it |

## One registry

The palette, the action bar and the coverage test all read the same tables the keyboard dispatches
from (`src/utils/hotkeys/`). `useHotkeys` publishes each mounted table, with its live context, to
the **command surface** (`use-command-surface-store.ts`); the palette lists what the surface holds
and runs it through the binding's own `run`. Adding a binding therefore adds a palette entry with
no further work, and a binding that should not be in the palette has to name the gesture that
replaces it.

## Round 6 (decided with the user, 2026-11-02)

- **The three-finger tap is robust against staggered fingers.** Fingers never land together, so
  the touch is judged as a whole, only once the last finger is up: the most fingers down together
  is three, the third landed within 150 ms of the first, no finger strayed further than 20 px, and
  first-down to last-up took at most 500 ms. The last lift of a recognised tap is stopped before
  any view sees it, so no one-finger tap, press or click is read from its fingers. A device whose
  own three-finger gesture (a screenshot, in some vendors' settings) takes the touch cancels it
  before the page sees it; switch that gesture off in the phone's system settings.
- **The subtree name matches the root title.** In a subtree the phone's top bar reads `‹ {current}`
  with the name in the root "Arlesh" title's size (`--text-lg`) and weight (700), on the same
  baseline; the chevron hangs to the left of the name, over the bar's gap, so the name starts where
  "Arlesh" does and toggling between root and subtree moves nothing (at 412 x 915: text box left
  56 px, baseline y 30 px, 16 px / 700 in both). The name beside it is the large tap target.
- **Full screen's hot square clears the display's rounded corner.** `MainActivity` pushes the corner
  radii (`WindowInsets.getRoundedCorner`, Android 12+) to `--corner-tl/-tr/-br/-bl` next to
  `--sat`/`--sab`; where the radius is unknown (older Android, desktop, standard bars) the CSS
  default is 16 px. The square sits `max(0.3 x radius, safe inset) + 8 px` in from the bottom and
  the right: a box at inset d lies inside an arc of radius r when d >= r(1 - 1/sqrt 2) = 0.293 r,
  so 0.3 r is that bound, the safe inset covers the gesture bar, and 8 px is the margin. (412 px
  wide: radius 16 -> 12.8 px in; radius 48 with a 24 px bar -> 22.4 px right, 32 px up; radius 120 -> 44 px.)
- **The Open and Filter search cards open lower.** On the phone the card sits a tenth of the screen's
  height (`10dvh`) below the status bar instead of at it, and its height is what is left above that,
  so it shrinks with the soft keyboard and the input stays above it. At 412 x 915 with a 24 px
  status bar the card's top moved from 24 px to 115.5 px (input 25 -> 116.5 px); with the keyboard
  up (a 549 px viewport) it opens at 78.9 px and ends at 463 px.
- **The quit dialog, and every warning prompt, is a centred modal on the phone** (decided with the
  user, 2026-11-02), horizontally and vertically, not a bottom sheet. They are all one component
  (`WarningConfirmModal`: Quit, backlog, delete, unfinished children, the scope and plan clamp
  prompts), so one change centres them all, with a margin round them clear of the system bars.
- **The system-bar choices are large segmented controls** (decided with the user, 2026-11-02): under
  Settings > General each setting (normal display, fullscreen) is a full-width row of three buttons,
  Standard / Edge-to-edge / Immersive, each at least 44 px tall with the selected one filled, instead
  of a dropdown. At 412 px the three labels fit (about 126 px each), so no stacked rows are needed.
  `SegmentedControl` is a `radiogroup` of `radio` buttons; there was no earlier one to reuse.
- **The desktop top bar's server indicator is gone** (decided with the user, 2026-11-02), as the
  phone's was in round 1. Settings > Server's status line has the mode, URL, reachability, last
  sync and version; an unreachable or mismatched server still shows the `ServerBanner`.
