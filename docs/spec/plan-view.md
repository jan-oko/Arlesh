# Plan View

*One area of the [Arlesh design specification](../../SPEC.md).*

A **planning pass** walks one Scope at a time and decides what goes in it. Neither of the other two
views is built for that: the Mindmap is structural, and the List View is flat and filter-driven, so
filling a week meant re-filtering, opening editors and setting Plans one at a time, with nothing on
screen saying what the scope already held.

The Plan View is a **two-pane triage** over one scope. On the left are the **candidates** — relevant
work that is unplanned, or planned to the scope one rung above. On the right is **the scope being
filled** — what is already planned into it. Moving a card across sets its Plan; moving one back clears it. That is the whole of what
this view writes.

It is a third tab beside Mindmap and List, and shares what they share: the tab's **subtree root**
and the tab's **filter set** (see [Tabs](tabs.md)). Entering a subtree anywhere in a tab narrows
this view too, and the status preset chosen in any of the three governs all three.

## The two panes

Rows are **Tasks**, the same flattened Task rows the List View builds, filtered by the shared
filter. Goals, Projects and Commitments are never cards: none of them has a Plan.

### The parent scope

The **parent scope** is the scope one rung above the one being filled, on the ladder `season →
month → week → day → part of day`: the week a day sits in, the month a week sits in, the season a
month sits in. It is stated against the scope being filled, not against the buckets a split draws
(see *Split by subscope* below) — splitting changes how the right-hand pane reads, not what the pass
is filling.

Two cases are not "exactly one":

- **A week at a month's edge has two parents.** Weeks do not nest in months, and a week that
  straddles a month boundary sits one rung below both months. Both are its parent, and work planned
  to either is offered. That is the same rule — the cells one rung up that the scope sits in —
  applied to the one rung that does not nest, not an exception to it.
- **A Season has none.** It is the only top-level scope, and that is the entire reason. This is
  **structural, not defensive**, and it does not generalise: "no parent" is not a fallback for a
  scope whose parent happens to hold nothing, and it is not a rule about empty panes. Every scope
  but a Season has a parent.

### The candidates

The left-hand pane holds the **relevant** work that is **unplanned, or planned to the parent
scope**:

- **Unplanned and relevant.** A Task with **no Plan** whose **effective** Time Scope overlaps the
  scope — a task's own window, or the nearest scoped ancestor's when it has none. An **Unscoped**
  Task is always here, because the model defines Unscoped as always relevant and a planning pass is
  exactly where always-relevant work should be offered.
- **Planned to the parent scope.** A Task whose Plan **is** the parent — committed a rung up, not
  yet placed here. Filling a week, the work pinned to its month. Planned *to* the parent, not
  "anywhere coarser": work pinned to the season is not a week's to place, because a pass places what
  the pass directly above it committed, and reaching two rungs up would be doing the month's pass
  inside the week's. The match is by the Plan's scope, not by containment, which is also what makes
  a straddling week work — neither of its months contains it.

**Show only planned to parent scope** hides the unplanned half. It is **on by default**, so a pass
opens on the one list that shrinks as you work; the unplanned pool is the same list however long
the pass runs, and leading with it would bury the work that has a decision waiting on it. The
switch *subtracts*: off, the pane shows both halves.

With a parent present and nothing planned to it, the switch on leaves the pane **empty**, and that
is the true answer — nothing was committed a rung up — so it is left to say so rather than falling
back to the unplanned half.

For a **Season** the switch is **inert**: drawn greyed out, with the reason on hover, and the pane
shows the unplanned relevant work whatever the switch says. There is no parent-planned half to show
or to leave, so hiding the unplanned half would empty the pane for a reason that has nothing to do
with the board. Inert is drawn rather than hidden so the menu does not change shape as you walk
kinds.

One more thing sits on the candidates side, and the switch does not touch it: with the planned pane
split, work planned to the scope being filled that **no bucket holds** — see *Split by subscope*.
It is neither unplanned nor planned to the parent; it is planned *here*, in no part of here, and it
is on this side because this is the side with the gestures that place it.

**The scope's pane** holds Tasks whose **Plan is contained in** the scope — containment, not
equality, so a Task pinned to Tuesday is part of what this week holds. A week being filled that did
not show its own days' work would under-report the load it exists to report. Once the pane is split,
work the split cannot place in a bucket leaves this pane for the candidates, where the gestures that
place it are.

A Task planned **somewhere else** — neither in this scope nor to its parent — is in neither pane.
It is not unscheduled, so it is not a candidate, and it is not in this scope, so it is not what the
scope holds.

**A judged Commitment's steps are not triaged.** A Commitment is never a card, so it reaches a
pass through the Tasks under it. Once it has a Verdict, **Kept or Broken**, nothing is left to plan
in its service, so its steps, at any depth, leave **both** panes the way a done Task does. The
shared Plan preset still shows a Broken Commitment with an open window in the List View's band, as
a live problem. That is a question about the Commitment. This one is about whether to spend time on
its steps, and the answer is no either way.

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

A card carries one button, and the selection answers `Enter`; the pane the card is in says which
direction is meant, so there is one gesture rather than two. With the planned pane split there is
**no** move into the scope itself — the buckets are its parts, and planning into the whole while
looking at them is the move the split exists to replace — so a candidate's button is absent rather
than present and refusing, and `Enter` says so in a toast instead of doing nothing.

### More than one row

**`Shift` and `Ctrl` select several rows**, as they do in every list: `Shift+↑`/`Shift+↓` and
`Shift+click` extend a run from the anchor, `Ctrl+click` adds or removes one row. A selection
belongs to **one pane**; crossing to the other leaves it behind, because the two panes are two
different questions and a run across both answers neither.

The selection is a set with an anchor over the **rendered** row order — the same order the arrows
walk, which under a split is the sections' order rather than the triage's. Section headings and path
headers are entries in that stream rather than wrappers around it, and none of them is landable.

**A batch is one Gesture**, so planning five rows is one `Ctrl+Z`. It is not an *atomic* one: a
batch that plans five of six has done five things the user can see on the board, and taking them
back because the sixth was refused would undo work nobody asked to undo. Whatever did not land is
counted in the toast — the refusals, a Backlog a plan took a task out of, and a straddling bucket
that carried its rows outside the scope being filled and so off the pane.

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

A batch where nothing moved leaves the selection where it was, on the work the toast is about. One
that moved something advances the cursor past it, to the next card still in the pane, so a pass is
`Enter`, `Enter`, `Enter` down the candidates.

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

## The two menus

**Each pane carries its own kebab**, beside its own heading, holding the switches that shape that
half:

```
Candidates   [x] Show only planned to parent scope     on  by default
             [x] Group by path                         on  by default

Planned      [ ] Split by subscope                     off by default
             [ ] Include premorning                    off by default
```

They were switches in the window's settings popover, gated on the Plan View being on screen. Two
problems with that, and the second is the one that mattered: a control three rows up from the thing
it acts on has to name which half it means, and a settings popover is somewhere you go once, not
somewhere you reach for mid-pass. A planning pass changes its mind about how it wants to read a pane
while it is reading it.

They stay **app-wide**, persisted beside *Asynchronous first*, and deliberately did not become
per-tab like the filters. A filter is a question about the board and belongs to the tab
asking it; these are questions about how the Plan View reads, and a pass that came up shaped
differently because it was started from another tab would read as a bug rather than as a setting.

**Show only planned to parent scope** is the candidates pane's own question, and is described under
[The candidates](#the-candidates) above, with the Season case that makes it inert.

**Group by path** draws a header above each contiguous run of rows sharing a location, spelling the
chain — `Growth › CODE › ARLESH › Features`. It is the List View's header: clicking a segment enters
that subtree and Ctrl-clicking files it as an Antecedent pill. The Plan View offers no **+** on a
header, because planning is the only thing this view writes.

It is the **candidates pane's** switch and groups that pane alone. That pane is read for *where*
work lives; the pane opposite it is read for *when*, which is the question its own menu answers, and
nesting both groupings in one column would have the sections and the headers competing for it.

**A row draws no path of its own while a header carries it.** The card's path line is what the
header replaces, and drawing both put the same chain twice on one line narrow enough to clip it. A
run that hangs straight off the frame has no chain to spell and gets no header, as in the List
View.

**Split by subscope** divides the **planned** pane into one section per subscope — the weeks of a
month, the days of a week, the bands of a day — so a whole month's buckets and their contents read
in one pass. The subscope is the next kind down the ladder `season → month → week → day → part of
day`; a Part of Day has nothing below it and does not split, and neither does an Exact window, which
is not a calendar cell.

**Include premorning** draws a Day's 02:00–06:00 band as a bucket of its own. Off by default: the
small hours are not where work gets planned, and a bucket nobody fills is a sixth of the pane spent
saying so. It is drawn regardless while something is planned into it — the pane never holds fewer
tasks than the triage put in it.

The candidates pane is **never** split. The work waiting there sits in no subscope, which is exactly
why it is waiting; bucketing it by relevance window instead was considered and rejected as answering
a different question from the one the pane asks.

The sections are always open — no disclosure triangles. Seeing every bucket at once is the point,
and a fold defeats it. Three rules keep the split from hiding anything:

- **Empty subscopes are drawn.** An empty week is the answer to "what is in this month" just as
  much as a full one, and it is the only way the pane can show a bucket you have not filled yet.
- **Straddling subscopes are drawn and marked partial, with their dates.** A month's first and last
  weeks usually poke outside it. Showing only wholly-contained subscopes would hide work planned
  into a straddling week from the month's view entirely.

  **Partial is a fact about days, not about windows.** A subscope's own days are compared against
  the scope's. A month's edge weeks genuinely straddle it; a week's days and a **day's bands never
  do**, because the whole ladder turns over at 02:00 and a Day contains its own Night (22:00–02:00)
  whole. Night's calendar *cell* still ends on the following date, for a grid to shade — reading
  that as containment is what once marked every day's last band as straddling its own day.
- **Work no bucket holds leaves the pane for the candidates**: a task planned to the scope *itself*
  while you are filling its parts, one whose plan spans several subscopes, and one whose plan has
  not been read back yet. It used to collect in a named catch-all at the top of the planned pane,
  among the work that was already placed and with no gesture that could move it. It still needs
  placing, so it belongs on the side that places things.

**Sectioning compares dates, never instants.** A scope row carries `start_date` and `end_date` as
plain dates, and so does a calendar cell, so "is this plan inside that week" is a string
comparison. Building a datetime window here would bake in what instant a day begins at — which is
the backend's answer, and not one this view may assume.

**The keyboard walks what is drawn.** A split reorders the pane, so the flat row list the selection
moves through comes from the rendered model rather than from the triage. Section headings and path
headers are entries in that stream rather than wrappers around it, and none of them is landable:
`Down` steps from the last card of one bucket to the first card of the next. Crossing panes still
keeps your place by index, against the drawn order on both sides.

**Up** — a button beside the step back — fills the scope's **parent** instead: a part of day's
Day, a Day's Week, a Week's Month, a Month's Season (see [The parent scope](#the-parent-scope)).
The kind selector changes with it, exactly as choosing the kind would, since the kind is what it
shows. A **week at a month's edge** has two parents; Up goes to the month holding the week's
**first day**, the natural reading of "the week's month". The candidates pane still counts both,
because that asks what was committed above the week, and Up asks where to stand, which is one place.
On a **Season** Up is disabled and says on hover that a Season is the top of the ladder — the same
structural reason *Show only planned to parent scope* is inert there. It is disabled for the moment
the scope is still being materialized, too, since its parent is not known yet. **`\`** does the same, and where the button is disabled the key does not do nothing: it
says the button's reason in a toast, because a press with no visible effect reads as a key that is
not bound. `\` was free in every table and sits beside `[` `]` on a US layout — the third key of
the cluster, for the one step that leaves the bracket axis.

Stepping walks from the materialized scope's own start date rather than from wherever the cursor
happened to sit inside it, so a month stepped from the 31st lands on the next month. Walking parts
of a day rolls over into the next or previous day at either end of the sequence.

A pass **opens on the current scope of the kind you last filled**: the kind is remembered with the
tab, the place in the calendar is not. "The week I last filled" is a stale week by the next morning,
and restoring it would put you to work on the past without saying so. With nothing remembered, the
kind is **Week**.

## Planning into a subscope

With the pane split there is no "plan into this scope", so a row reaches a **bucket** three ways.
All three act on the whole selection, and all three write one Gesture.

**Drag and drop.** Each bucket is a drop target, and lights up under the pointer. Dragging a card
that is part of the selection carries the whole selection; dragging one that is not selects it
first, so the pointer and the keyboard are never talking about different rows. With the pane split
the buckets are the **only** targets in it — dropping on the pane at large would be planning into
the scope itself — and the pointer says so on its own, because over the gaps there is nothing that
accepts the drag. Dropping on the candidates pane takes work back out of the scope.

**A number.** `1` through `7` name the buckets by **position in the pane**, which is the calendar's
own order, and every bucket is always drawn, so `3` is the third week of the month you are filling
for as long as you are filling it. It renumbers when you step to another scope, because it names a
place in what is on screen and that is the whole of what it promises. A number that tried to name a
*week* rather than a position would have to survive a month with five of them and one with six.
Nothing has more than seven buckets — a season has three months, a month four to six weeks, a week
seven days, a day six bands — so one digit always suffices.

**A letter, where one is unambiguous.** A bucket's **initial** reaches it when that initial names it
and nothing else among the buckets drawn, and when the letter is not already a gesture in this view.
One rule, no table:

- Days of a week keep **M**onday and **W**ednesday. Tuesday/Thursday collide on T and
  Sunday/Saturday on S, so those four take their numbers. Friday's F is spent on *show the board
  alone*.
- Parts of a day keep **P**remorning, **M**orning and **A**fternoon. Noon and Night collide on N;
  Evening's E is spent on *open the editor*.
- A season's months keep whichever initials differ — September/October/November all do;
  March/May collide and leave April.
- **A week number never gets a letter.** Every week of a month is called "W39", "W40" — all the same
  initial, all colliding — so the rule produces no letter for any of them, which is exactly right.

A guard could have told some of the spent letters apart from a bucket key — bare `F` only fires with
nothing selected — but one key meaning one thing is worth more in a triage pass than the last two
mnemonics.

The keys a bucket answers to are **drawn on its heading**. A shortcut nobody can see is a shortcut
nobody uses, and the assignment that draws them is the same one that dispatches them, so a key that
is drawn always works and a key that is not is not bound at all — it falls through rather than
eating the press.

Planning into a **straddling** bucket is allowed and says so: what lands there is no longer inside
the scope being filled, so it leaves the pane, and a toast names the bucket rather than leaving the
move looking like a failure.

## Keyboard

- `↑` / `↓` — move the selection within the focused pane
- `Shift+↑` / `Shift+↓` — extend the selection from its anchor
- `←` / `→` — cross to the other pane, keeping your place in the list
- `Enter` — move the selection across: into the scope from the left, out of it from the right. With
  the planned pane split there is no move into the scope, and `Enter` from the left says so
- `1`–`7`, and an unambiguous initial — plan the selection into that subscope
- `[` / `]` — fill the previous / next scope
- `\` — fill the parent scope; on a Season, says why there is none
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
