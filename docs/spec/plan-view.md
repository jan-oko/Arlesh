# Plan View

*One area of the [Arlesh design specification](../../SPEC.md).*

A **planning pass** walks one Scope at a time and decides what goes in it. Neither of the other two
views is built for that: the Mindmap is structural, and the List View is flat and filter-driven, so
filling a week meant re-filtering, opening editors and setting Plans one at a time, with nothing on
screen saying what the scope already held.

The Plan View is a **two-pane triage** over one scope. On the left are the **candidates** — the work
that is relevant now and unscheduled. On the right is **the scope being filled** — what is already
planned into it. Moving a card across sets its Plan; moving one back clears it. That is the whole of
what this view writes.

It is a third tab beside Mindmap and List, and shares what they share: the tab's **subtree root**
and the tab's **filter set** (see [Tabs](tabs.md)). Entering a subtree anywhere in a tab narrows
this view too, and the status preset chosen in any of the three governs all three.

## The two panes

Rows are **Tasks**, the same flattened Task rows the List View builds, filtered by the shared
filter. Goals, Projects and Commitments are never cards: none of them has a Plan.

**Candidates** are Tasks with **no Plan** whose **effective** Time Scope overlaps the scope being
filled — a task's own window, or the nearest scoped ancestor's when it has none. An **Unscoped**
Task is always a candidate, because the model defines Unscoped as always relevant and a planning
pass is exactly where always-relevant work should be offered.

**The scope's pane** holds Tasks whose **Plan is contained in** the scope — containment, not
equality, so a Task pinned to Tuesday is part of what this week holds. A week being filled that did
not show its own days' work would under-report the load it exists to report.

A Task planned **somewhere else** is in neither pane. It is not unscheduled, so it is not a
candidate, and it is not in this scope, so it is not what the scope holds.

**Virtual Habit occurrences and iteration roots are not triaged.** They have no row to carry a Plan,
and planning a recurrence is a separate question. A first cut plans real Tasks.

## Backlog

**Backlogged Tasks are excluded by default, behind a switch.** Backlog means *deliberately not now*,
and a planning pass is also when you reconsider that — so the work is off the table until you ask
for it, and one switch away when you do.

The switch **is** the backlog question in this view: it overrides the shared Backlog pill rather
than combining with it. Combining would make the switch a control that visibly did nothing under the
Plan preset, which hides backlogged work of its own accord.

Planning a backlogged Task **takes it out of the Backlog** — the model forbids a Task being both
(see [Resources](resources.md)) — and the view says so in a toast rather than leaving it to be
noticed from a badge that quietly stopped being drawn.

## Moving a task across

A card carries one button, and the selected card answers `Enter`; the pane the card is in says which
direction is meant, so there is one gesture rather than two.

**A containment failure refuses the move**, with a toast naming the bound. `Plan ⊆ TimeScope` and
`child.Plan ⊆ parent.Plan` both hold as written (see [Time Scopes & Planning](time-scopes.md)), and
the task's own window is **not** widened on the user's behalf: a window is a statement about when
work *matters*, and changing one is an editing decision, made in the editor.

The two bounds are checked in the order the backend checks them — the task's own Time Scope first,
then the nearest planned ancestor's Plan — so the view's refusal and the backend's cannot disagree
about which bound stopped a move. The check is made **before** the write purely so the message can
be specific; the backend enforces the same two rules on the way in, and a refusal that somehow
reaches it is still refused, just less precisely. A bound whose window has not resolved yet refuses
nothing here and is left to the backend.

A refused move leaves the selection on the task the toast is about. A move that happened advances it
to the next card in the pane, so a pass is `Enter`, `Enter`, `Enter` down the candidates.

## Walking the scopes

Any **canonical** scope kind can be filled — Season, Month, Week, Day or Part of day — chosen by a
kind selector. An **Exact** window is deliberately not offered: an arbitrary `[start, end)` is not a
place on a calendar, and "the next exact scope" has no meaning.

The header carries the kind selector, the scope in words with a step either side of it, and the
Backlog switch. Clicking the scope opens the app's own **Scope Picker** as a jump picker, locked to
the kind being filled — the kind is the selector's question, and descending into a week from the
month view would answer it a second way, leaving the selector beside it saying something else. It
opens **anchored on the scope the bar is showing**, not on today, so jumping starts from where you
already are; which cell it marks as *current* is still the real instant, so browsing forward does
not relabel the week you landed on as the current one.

**Two switches, both off by default** (gear popover, shown only while the Plan View is active,
persisted app-wide beside *Path icons* and *Asynchronous first*). They are separate switches, not
one, because they answer different questions — *where the work lives* against *when it is planned*
— and a planning pass wants them in different combinations.

**Group by path** draws a header above each contiguous run of rows sharing a location, spelling the
chain — `Growth › CODE › ARLESH › Features` — exactly as the List View does, in **both** panes. It
is the same header: clicking a segment enters that subtree, Ctrl-clicking files it as an Antecedent
pill, and the *Path icons* switch governs its glyph here too. The Plan View offers no **+** on a
header, because planning is the only thing this view writes.

**Split planned by subscope** divides the **planned** pane into one section per subscope — the
weeks of a month, the days of a week, the bands of a day — so a whole month's buckets and their
contents read in one pass. The subscope is the next kind down the ladder `season → month → week →
day → part of day`; a Part of Day has nothing below it and does not split, and neither does an
Exact window, which is not a calendar cell.

The candidates pane is **never** split. Candidates are unplanned, so they sit in no subscope; there
is no bucket to put them in, and bucketing them by relevance window instead was considered and
rejected as answering a different question from the one the pane asks.

The sections are always open — no disclosure triangles. Seeing every bucket at once is the point,
and a fold defeats it. Three rules keep the split from hiding anything:

- **Empty subscopes are drawn.** An empty week is the answer to "what is in this month" just as
  much as a full one, and it is the only way the pane can show a bucket you have not filled yet.
- **Straddling subscopes are drawn and marked partial, with their dates.** A month's first and last
  weeks usually poke outside it. Showing only wholly-contained subscopes would hide work planned
  into a straddling week from the month's view entirely.
- **Work that sits in no single subscope goes to a named catch-all**, drawn first and only when it
  holds something: a task planned to the scope *itself* while you are filling it, one whose plan
  spans several subscopes, and one whose plan has not been read back yet. The pane never holds
  fewer tasks than the triage put in it.

With both switches on, rows inside a section still carry their path headers. The two groupings
nest rather than compete, because they say different things: the section says *when*, the header
says *where*.

**Sectioning compares dates, never instants.** A scope row carries `start_date` and `end_date` as
plain dates, and so does a calendar cell, so "is this plan inside that week" is a string
comparison. Building a datetime window here would bake in what instant a day begins at — which is
the backend's answer, and not one this view may assume.

**The keyboard walks what is drawn.** A split reorders the pane, so the flat row list the selection
moves through comes from the rendered model rather than from the triage. Section headings and path
headers are entries in that stream rather than wrappers around it, and none of them is landable:
`Down` steps from the last card of one bucket to the first card of the next. Crossing panes still
keeps your place by index, against the drawn order on both sides.

Stepping walks from the materialized scope's own start date rather than from wherever the cursor
happened to sit inside it, so a month stepped from the 31st lands on the next month. Walking parts
of a day rolls over into the next or previous day at either end of the sequence.

A pass **opens on the current scope of the kind you last filled**: the kind is remembered with the
tab, the place in the calendar is not. "The week I last filled" is a stale week by the next morning,
and restoring it would put you to work on the past without saying so. With nothing remembered, the
kind is **Week**.

## Keyboard

- `↑` / `↓` — move the selection within the focused pane
- `←` / `→` — cross to the other pane, keeping your place in the list
- `Enter` — move the selected task across: into the scope from the left, out of it from the right
- `[` / `]` — fill the previous / next scope
- `Shift+B` — show or hide backlogged candidates. Shifted deliberately: bare `B` backlogs the
  selected Task in the List View, and a key that sets one task aside must not reveal a whole
  category of them elsewhere
- `E` — open the selected task's editor; `Escape` — deselect
- `Alt+F` — the filter menu, also global; `Alt+A`/`Alt+P`/`Alt+S`/`Alt+D`/`Alt+B` — the shared status
  presets
- `Ctrl+O` — search every node and enter the one you pick; `Shift+Escape` / `Ctrl+Escape` — up one
  subtree level / back to the true root. All three are [global bindings](tabs.md): they act on the
  tab's subtree root, which every view shares
- `Ctrl+Z` / `Ctrl+Shift+Z` — undo and redo, which cover a move like any other board change
- `F` with nothing selected — the board alone

**`Ctrl+P` shows this view**, from wherever you are — see the switcher in [Tabs](tabs.md). It is
gated on nothing having the keyboard, like the other two view chords: switching views out from under
an open editor would leave the editor sitting over a board it no longer belongs to.

## What this view does not do

- **Time Scope editing.** This view sets Plans. A candidate whose window is too narrow for the scope
  is refused and sent to the editor.
- **Creating, renaming or deleting.** A planning pass decides *when*, not *what*.
- **Habit iterations and virtual instances as candidates**, as above.

---
