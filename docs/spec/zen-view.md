# Zen View

*One area of the [Arlesh design specification](../../SPEC.md).*

The other views all show *more* than what is in hand: the Mindmap the whole reachable tree, the
List View every live row under a path header, the Plan View two panes of triage, the Steps View a
Step and its children. The **Zen View** shows only **what you are doing now** — the List View's
Task rows under the **Do** preset — as a grid of cards that fills the window, with the
Commitments still to judge and the Expectations still open drawn as two thin strips above it. Few
things in progress make big cards with big titles; many make small ones. Nothing else is on
screen.

It is reached from the top bar's view selector (after Steps) or with **`Ctrl+J`**, from any view
(see *Switching views* in [Tabs](tabs.md)). It was designed against a clickable mock of the agreed
layout ("option A", 2026-09-29).

## Always the Do preset

Exactly as the [Plan View is always Plan](plan-view.md#always-the-plan-preset), the Zen View
**always reads under Do**, whatever the tab's own preset is:

- The top bar's preset control shows **Do** while this view is active; the other presets are drawn
  but disabled, each saying on hover that the Zen View always reads under Do, and so does the
  closed control.
- `Alt+A`/`Alt+P`/`Alt+S`/`Alt+D`/`Alt+B`, and the List View's `Alt+U` and `Alt+E`, change nothing
  here and say so in a toast. They are left off this view's cheat-sheet.
- The tab's own preset is **not overwritten**: the view reads the board *as* Do, and switching to
  another view gives the tab its preset back. The Plan preset's scope narrowing is not read either,
  since Do never consults it.

Everything else in the shared filter applies as it does in the other views: tags, Private Mode, the
Info/Flow toggles, the Archived and Backlog pills.

**Of the List View's own pills, the Zen View reads Agentic alone** (ruled by the user, 2026-09-29).
Its Filter menu has a **Tags** row and an **Agentic** row below the switch block, and the Agentic
pill works exactly as the List View's: added as All, Shift Any, Alt Not, a click cycles its mode,
`a` in the open menu adds it in the key's mode, and `Ctrl+F` finds it. It is the same stored pill
the List View reads, per tab, so one set in either view applies in both. It narrows the **grid**
only: Agentic asks about Tasks, and a Commitment or a wait does not answer it. It draws **no chip**
under the top bar, like the Mindmap's own filters — it is set and seen in the Filter menu (and
`Ctrl+F`), and while it is set the Filter button wears its [dot](mindmap-view.md#filter-dot). The List View's other pills (Under, Depends on, Scope, Blocked, Asynchronous, Private,
Task/Goal/Project status, Verdict) do not apply here and are not offered, so none can narrow this
view unseen.

## The grid

**Contents.** Exactly the List View's Task rows under Do — stored, flow-materialized and Habit
occurrences alike, and a wait's check task — in the tab's current subtree (the same shared subtree
root every view re-roots with), **flat, in plain board pre-order**: the order the tree draws them,
with no path headers, no indentation and **no Asynchronous-first partition**, whatever the List
View's setting says (ruled by the user). The **focus exemption** holds as elsewhere ([Filtering
Logic](filtering-logic.md)): a card your own edit stops matching — cycling it to Done with `Enter` —
stays where it is, dimmed, until the selection leaves it.

**A card** carries its **title**, large; beneath it the **parent path** — every ancestor between the
view's frame and the Task, `Growth › CODE › ARLESH`, the line left-to-right with each title isolated
so a Hebrew title reads correctly inside it (the Plan View's rule); and, when the card is tall
enough, the standard **status-badge row** the Mindmap, the List View and the Steps View draw, from
the same component. The three are **one block, centred** on the card both across and down (ruled by
the user, 2026-09-29), so the path and the badges sit under the title whatever its direction. The
title is drawn with `dir="auto"`, so a Hebrew or Arabic title reads right-to-left. The card is
washed in its **aspect's colour**, flat, from the shared stylesheet the List and Steps cards use. A
selected card has the selected border, and an **Overdue** card the amber overdue border while **Show the overdue border on cards** is on (see *Settings*), the selection winning on a card that is both; the card carries no status control (the badge row and the
title are the whole card, as decided) — `Enter` is the status gesture.

**Size to fit.** The grid **always fills the area left below the strips**, and never scrolls while
the cards can stay at least the minimum size:

- Every column count from 1 to the number of cards is tried. A count gives each card a cell of
  `(width − gaps) / columns` by `(height − gaps) / rows`; the count chosen is the one whose cell
  holds the **largest 2.4 : 1 box** (the width of `min(cellWidth, 2.4 × cellHeight)`), among counts
  whose cell is at least the minimum. Ties go to fewer columns. Cards then **fill their cells**, so
  they are not held to 2.4 : 1 — the ratio only chooses the shape of the grid.
- The **last row is centred** when it is short.
- **Minimum card: 160 × 48 px.** 48px is one title line at the normal text size (14px), a path line
  at the small size (12px) and the card's padding; 160px keeps a short title readable. When no
  column count gives a cell that large, the grid switches to **scrolling**: cards are 48px tall, as
  many columns as fit at 160px wide (at least one, never more than there are cards), filling the
  width, and the grid **scrolls vertically**. Nothing is ever hidden or paged.
- Gaps between cards are 12px.
- The measurement follows the area both ways as the window, a strip or the fullscreen mode changes
  it. Before the area has a real size (the first frame, or a test environment without layout) the
  grid draws at the minimum size, scrolling.

**Scaling.** Usually one to three Tasks are in progress, so the view is designed first for a few big
cards. The title's font size is `min(0.28 × card height, 0.08 × card width)`, held between **14px**
(the normal text size — what a minimum card gets) and **112px** (one card across a full-HD window).
Everything else keeps to the title's scale, so a big title never sits over a line of small print:
the **path** is half the title (at least 12px), each **badge icon** 0.4 of it (at least 12px), and
the card's **padding** 0.3 of it (at least 6px), with a third of that between the title, the path
and the badges. A long title wraps and is clamped to the lines the card has room for, ending in an
ellipsis; its full text is the card's tooltip.

**Badges** are drawn only when the card is at least **72px** tall and the **Show badges on cards**
setting is on — see *Settings*.

**The status icon.** The grid is In Progress work, so a card says its status only when it is
**something else**: a **Started** card (with *Show Started tasks on the grid* on), or a card the
focus exemption holds after your own edit made it **To Do**, **Done** or Started. Such a card leads
its **badge row** with the Task status glyph every other view draws — Started is In Progress's glyph
with the inner circle unfilled — at the badge row's scale, like the badges beside it (ruled by the
user, 2026-09-30; a first cut put a Started glyph on the title line). An In Progress card draws
none. The icon is part of the badge row, so it **hides when the row hides**: with *Show badges on
cards* off, or on a card shorter than 72px. (Chosen as the least surprising reading of "the status
row": one switch and one height rule for everything under the title.)

## The strips

Above the grid, **Commitments first, then Expectations**, each a **single horizontal row of small
cards** — the kind's glyph and the title at the normal text size (14px), in a pill with 6px × 14px
of padding, aspect-washed — that **scrolls sideways** when it is longer than the window. The grid resizes to fill what the strips leave. A strip with nothing in it
**takes no space at all**; there is no heading, the glyphs say which strip is which.

- **The Commitments strip** holds what the List View shows under Do: every **unresolved**
  Commitment (the Commitment rule the presets share, `passesCommitmentPreset`), with the same
  subtree gates and hard-hide rules.
- **The Expectations strip** holds what **Start** shows for Expectations — a pending, live wait
  whose window is open (neither Pending nor Lapsed), honouring the app-wide **Start hides waits that
  have checks** setting — with the same subtree gates. Do shows no Expectations at all, so this
  strip is the one place the Zen View reads a preset other than Do; it overrides the preset for this
  strip only. It is a frontend reading: the List View's Expectation filter is asked under Start, and
  nothing reaches the board filter the backend or the MCP sees, so the conformance corpus is
  unchanged.
- Each strip is shown or hidden by the Zen View's **own per-tab toggle**, **both on by default**,
  independent of the List View's row-kind selector. The toggles are switched **from the Filter
  menu, the way the List View's row kinds are** (ruled by the user, 2026-09-29): a **Commitments**
  and an **Expectations** switch at the top of the switch block, drawn while the Zen View is active,
  with the same keys while the menu is open — `c` / `e` toggle one (Alt too), Shift shows that strip
  alone — and the same `Ctrl+F` results. There is no Tasks switch: the grid is always shown, so
  both strips may be off. **Reset** turns both back on (and clears the Agentic pill). There is no
  view binding for them, as the List View has none for its kinds. The toggles are kept with the tab
  (`zenCommitments`, `zenExpectations` in its view state); a tab stored before the Zen View existed
  has neither field and reads as both on, so it loads unchanged.

## Keyboard

The Zen View has **its own selection**, as each view does, and takes **the List View's key
bindings, except every create key** — no `Tab`, `Shift+Enter`, `Shift+E` or any other chord that
makes a node. The bindings are not copied: the Zen table is built from the List View's own binding
modules, re-sectioned for the cheat-sheet, with the create modules left out. So a key's meaning can
never drift between the two views. The strips and the Agentic pill are switched from the Filter menu
(`Alt+F`, then `c` / `e` / `a`), as the List View's row kinds and flags are.

- `↑` `↓` `←` `→` — move in **two dimensions** (below)
- `Enter` — on a Task, cycle its status (disabled while it is blocked; on a check task, complete the
  check); on a Commitment, cycle its verdict; on an Expectation, release it or take the release back
- `Alt+Enter` — on a Task, set it **Started** from To Do or Done, or flip In Progress ↔ Started
  (disabled while it is blocked). A Task set Started leaves the grid unless *Show Started tasks on
  the grid* is on, under the focus exemption like any card an edit stops matching
- `X` — mark the selected Commitment Broken
- `E` — open the selected card's editor; a **double click** does the same, a click selects
- `R` — rename the selected Task in place, in its card
- `P` — the quick Plan picker at the card; `D` — the quick dependency picker at the card
- `B` / `A` / `W` / `V` — backlog, agentic, asynchronous, compound (see
  [*Compound*](resources.md#compound)); `Shift+W` — the Task's editor at its
  Expectation section, with Asynchronous on
- `Delete` — delete the selected card after the usual confirmation, with the List View's cascade
  and its "next card, else the one before" rule for where the selection goes
- `Ctrl+Home` / `Ctrl+End` — the first / last card in drawn order (the Commitments strip, then the
  Expectations strip, then the grid)
- `J` / `K` — scroll the grid without moving the selection, when it scrolls at all
- `Escape` — deselect; `F` with nothing selected — the board alone
- `Ctrl+Z` / `Ctrl+Shift+Z` — undo and redo
- `Ctrl+J` shows this view; `Ctrl+O`, `Shift+Escape`, `Ctrl+Escape`, `Alt+F`, `Ctrl+F` are the
  [global bindings](tabs.md) as everywhere

**Moving in two dimensions.** The grid is read in rows; the last row may be short and is centred.

- `←` / `→` in the grid step to the previous / next card in **reading order**, continuing onto the
  next row at a row's end — so every card is reachable with the two keys alone. They stop at the
  first and last card.
- `↑` / `↓` in the grid move to the row above / below, landing on the card whose **centre is
  nearest** the current card's centre as drawn — which is what matters when the short last row is
  centred under a full one. On a tie the earlier card wins. `↓` on the last row does nothing.
- `↑` from the grid's **top row** enters the strips: the **Expectations** strip if it is showing
  and has cards, else the Commitments strip, landing on the strip's **first** card. `↑` from the
  Expectations strip goes on to the Commitments strip.
- `↓` from a strip goes to the strip below it, or from the lowest strip back to the grid's **first**
  card. `←` / `→` move along a strip and stop at its ends; the strip scrolls sideways to keep the
  selection in view.
- With nothing selected, any arrow selects the grid's first card, or — with the grid empty — the
  first card of the first strip.

## Settings

A **Zen** page in the settings modal, with three app-wide switches: **Show badges on cards** (default
on), **Show Started tasks on the grid** (default **off**; ruled by the user 2026-09-30). The
second stands in for the Do preset's own *Do shows Started tasks* while the view reads under Do: the
two are separate settings, so a paused task can be in the Do list and off the focus grid, or the
other way round (see [*Tasks*](resources.md)). Per-badge settings are deliberately not offered. The third is **Show the overdue border on cards**
(default on; ruled by the user, 2026-09-30, "in zen it's toggleable in settings"): off, an Overdue
card is drawn with the ordinary border, but still says *Overdue* in its accessible description. Zen
is the only view where the border can be turned off; everywhere else it is always drawn.

## What this view does not do

- **Creating** anything. Every create key is absent, not refused.
- Mixing Commitments and Expectations into the grid ("option B" in the mock) — they have their
  strips.
- Reading the List View's pills other than Agentic, its row-kind selector or its Asynchronous-first
  setting.
- Anything to the List View's own behaviour.
