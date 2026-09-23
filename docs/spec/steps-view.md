# Steps View

*One area of the [Arlesh design specification](../../SPEC.md).*

Neither of the other views lets you look at exactly one thing and what is directly inside it. The
**Mindmap** draws the whole reachable tree at once — its strength when you are placing work in
context, and a wall when you are not, because a wide branch means visually filtering out everything
you have already decided is irrelevant. The **List View** solves the opposite problem: it flattens
to Tasks, with the structure demoted to a path header, so you cannot walk the board through it at
all. The **Plan View** answers *when*, not *what is in here*.

The Steps View shows **one Step at a time**. The node you are standing on is a **header card**, its
direct children are cards beneath it, and nothing deeper is drawn. Entering a card makes it the
Step; the ways back out are the ones that already exist.

## Vocabulary

A **Step** is the node you are standing on plus its direct children — one screenful of this view.
You **descend** into a card and **climb** back out. The metaphor is a staircase.

Deliberately not *level*: [Habits](habits.md) already uses that for a scope level (day → week →
month → season), with "level node" as a concrete thing. The term is in
[`CONTEXT.md`](../../CONTEXT.md)'s glossary.

## Descending, and climbing

**Descending moves the tab's shared subtree root** — the same `enterSubtree(id)` that `Ctrl+O` and
the breadcrumb call. That is the whole of what makes this a reading of one board rather than a
fourth board: switching to the Mindmap afterwards lands on the node you walked to, the breadcrumb
names the Step exactly as it does elsewhere, and the tab's label follows.

There is deliberately **no Steps-specific exit gesture**. `Shift+Escape` climbs one level,
`Ctrl+Escape` goes back to the true root, and a breadcrumb click jumps to any level above — all of
them [global bindings](tabs.md), because where the tab is rooted is the tab's business and not this
view's.

**The selection is Steps' own**, as the Mindmap's and the List View's are. What the views share is
the subtree root, not what is picked inside it.

### What can be descended into

A card opens when **it already holds something**, or when **it could be given something**. A leaf
Task, an Info note and a virtual Habit occurrence all open on an *empty* Step that offers to create
the first child: a leaf is not a dead end, and refusing to enter one would make "what is under
this?" a question you can only ask where the answer is already yes.

What is refused says why rather than doing nothing: a **drawing** — anything rendered rather than
stored, such as a folded run of Habit history — which has no inside at all. Every *real* node opens,
a **Tag** included: a tag is a label, and the one thing you hang on a label is a note about it.

The predicate is `canParentAnyNewChild` in `node-meta.ts`, the same one the creation gestures ask;
there is no second opinion about what can hold a child, which is why teaching the model that a Tag
takes notes moved this rule with it and cost nothing here.

**Virtual nodes are enterable** — a Habit iteration or occurrence is a node like any other here. The
persistence hazard is already handled and needs no second mechanism: `use-subtree-nav.ts` runs a
recovery effect when `subtreeRootId` names a node `pathToNode` cannot find and calls `onExitToRoot`,
so descending into a virtual node and reloading lands at the true root rather than on a blank screen.

**`Enter` on the card you are already standing on** is refused with a toast rather than silently
re-rooting where you already are.

### Passed Habit iterations are not folded here

The Mindmap folds a run of passed iterations into one `habit_group` node because it draws a whole
subtree at once. A Step draws one level and paginates, which answers the same problem without
inventing a node — and folding could not work here anyway: a folded run is drawn rather than stored,
so descending into one would set the tab's root to an id `pathToNode` cannot find and the recovery
above would bounce you straight back to the true root.

## The header card

The header card is not decoration. It keeps the thing you entered visible and **actionable** rather
than only named in the breadcrumb, so its status, badges and editor are reachable without leaving
the level.

It is the **first cell of the arrow grid** — one navigation model, nothing extra to learn. The
consequence is handled deliberately: arrowing up from the top row changes *what you are standing on*
rather than *what you are choosing*, so the header card has to read as a different *kind* of cell.
Its **full width**, against a row of fixed-width cards, is what says so — no accent border and no
label spelling it out.

**At the true root the header card is the board, and it says only the app's name, centred.** Every
Step has the same shape and the root is addressable, but there is no node there to draw — so rather
than an empty form, or a strapline explaining what the absence of one means, it carries the name and
stops. A child count there would be the one number on the board nobody decides anything from.

The *behaviour* is the same as on any header card: every gesture that would act on a node is refused
there out loud (`E`, `Space`, `B`/`A`/`W`, `Enter`), because a *selected* card that answers nothing
in silence reads as a broken key. Bare `F` still shows the board alone only when nothing at all is
selected, which is why "the board is selected" and "nothing is selected" are two states rather than
one.

## What a card carries

**A card carries what the editor carries.** A Mindmap node is a title, a glyph and a badge row; a
List card adds tag pills. A Steps card is a **read mode of the editor** — the fields you would open
the editor to see, laid out to be read. That density is what separates this view from the other
three.

**It costs no extra loading.** `MindmapNode` already carries nearly everything the editors edit,
resolved on load: status, block reasons, virtual blockers, Time Scope, on-exit behaviour, timing,
resolution, archival, backlog, agentic (own and inherited), asynchronous, verdict, Verdict Window,
Plan, tags, beads id, privacy, knowledge-base directory, info details and the flow/habit data.
**No per-card fetch, no N+1.**

**The field set is per kind**, derived as the editors derive theirs rather than rendering everything
and hiding the blanks — a Commitment's Verdict Window is meaningless on a Domain, and a Task's
Backlog is meaningless on a Goal. A field the node has no value for is left out entirely.

**A card never repeats what its icon or its badge row already says.** Those two are not decoration:
the glyph encodes a Task's and a Goal's status (and its blocked-ness), a Commitment's Verdict, and
whether a Flow recurs; the badge row carries every boolean flag there is. So `Status`, `Verdict`,
`Recurrence`, `Backlog`, `Agentic` and `Asynchronous` are **not** fields — each was a second copy of
something already on the card, in a view whose only scarcity is vertical space.

The line is drawn at **boolean against value**. A badge says a Task *has* a Time Scope; only a field
says it is *this week*. The badge is the duplicate; the value behind it is not.

| Kind | Fields, in reading order |
| --- | --- |
| Task · Goal | Time Scope, Plan, On scope exit |
| Commitment | Verdict Window, Time Scope, Plan |
| Info | Details |
| Project | Status, Knowledge base |
| Aspect · Domain · Tag | Knowledge base |
| Flow | Instance Type |
| Flow item | Time Scope |

Every kind then reads **Blocked by**, **Tags**, **Issue** and **Private** after its own. A Project's
Status stays a field because no icon draws it and no badge carries it.

**Under the fields, the node's first Info notes, as bullets — as many as the card's height leaves
room for.** A card is a fixed height at a given zoom and every row in it is a single line, so how
many fit is arithmetic rather than a measurement per card. A note too long for its line is
**truncated, never dropped**: a clipped note still says it exists and roughly what it says, where a
dropped one says nothing at all, and the whole of it is one `E` away. When the notes outrun the
room, the **last line becomes a count of what is left** rather than one more note — it costs a note
to say it, and that is the right trade, because a note you cannot see is a note you do not know to
go looking for.

**Reuse, not re-derivation.** Badges come from `deriveStatusIndicators`, the glyph from `NodeIcon`,
and the scope and plan labels from the formatters the editors use — so a node's state reads the same
whichever surface you meet it on.

### What the fill says

**A card's fill is the aspect it lives under.** Every node on a Step is coloured by the part of the
board it belongs to, so a Step reads at a glance as one place rather than a set of unrelated cards.

It is **not the aspect colour itself**. A small, fixed share of that hue is mixed into the theme's
own card background, giving an opaque low-chroma surface. That distinction is the whole of what
makes it legible, and it is worth stating why: the rule this replaces painted the colour on at an
opacity that fell off with depth, which meant an **Aspect's own card** — depth zero — was drawn at
full strength with body text over it, and was unreadable in both themes.

Mixing instead makes contrast a property of the rule rather than of which node you are looking at.
The result is never further from `--node-bg` than `--card-aspect-strength`, and the theme already
guarantees `--node-text` against `--node-bg` — so every aspect works in both themes by construction,
including a pale one like Steel, and including the Aspect card itself. The strength is per theme:
a dark background needs more of the hue than a light one to read as coloured at all.

A node **outside any aspect** keeps the theme's plain card background, and the board's own header
card is not coloured at all.

**The fill says nothing about state**, deliberately. That is only safe because the glyph and the
badge row already do: the Task and Goal icons draw their status and their blocked-ness, the
Commitment shield draws its Verdict, and the badge row carries archived, frozen, backlogged, agentic
and asynchronous. It is the same reasoning that took those out of the card's fields — with state
covered twice over, the fill is free to spend itself on *where* the node lives, which nothing else
on the card says.

The **List View is not coloured this way.** Its rows are tinted by status (see
[List View](list-view.md)), because a flat list of Tasks drawn from everywhere is answering a
different question: there, where a row came from is what the path header says in words, and what it
*is* has nothing else to carry it.

## Editing

**Cards are read-only.** `E` opens the real editor, exactly as elsewhere — one editing surface, not
two, and inspecting and descending stay different gestures. Status cycling and the flag keys still
act on the selected card, as they do on a Mindmap node.

Because a Steps card is any kind at all, the editor fan-out every view used to carry its own copy of
is now one shared component: the List View and the Plan View could get away with two kinds each
because a row there is only ever a Task or a Commitment, and that is what stopped being true here.

**Three kinds have no editor at all** — an Aspect, which is fixed; a folded run of Habit history,
which is a drawing; and a virtual Habit occurrence, which is rendered from its template rather than
stored. `E` on one of them is **refused out loud**. That it is one named predicate rather than a
silent `return` in the gesture and a `null` branch in the modal matters: two encodings of the one
fact is how this view shipped a card that set the editor open, drew no modal, and left the keyboard
captured with nothing on screen to release it.

An **empty Step offers to create the first child**, which arrives through the parent's own default
child kind and opens straight into its editor to be named. Creation gestures beyond that — `Tab`,
`Shift+Enter` — are not in the first cut.

## Filtering

A Step honours the tab's shared filter and status preset, so it shows the set the other three views
would show. The node you are standing on is read from the **unfiltered** tree: it is what you walked
to, so the filter never takes it out from under you.

The **focus exemption** applies as it does elsewhere: the selected card stays on the Step even once
your own edit stops it matching, so cycling a Task to Done under **Plan** does not erase it from
under the cursor.

## Pages and zoom

A wide Step **paginates** rather than scrolling. **Card size is a per-tab zoom** with five levels,
set in the gear popover under Steps (and on `Ctrl+=` / `Ctrl+-`), the way the branch axis is set
there under Mindmap: one tab walking a wide branch wants small cards while another reads one Task's
fields at full size.

**Page size is derived from the zoom and the viewport, never set independently.** The two would
otherwise contradict each other on the first window resize — a page of twelve in an area that fits
eight either overflows or scrolls, and not scrolling is the point. Zoom is the control; the page
follows it and the window.

Pagination means the staircase has **landings**, and moving between them has its own affordance:
`PageUp` / `PageDown` and a pager below the cards. Deliberately not an arrow (an arrow that
sometimes moved the cursor and sometimes replaced every card would be the one movement here you
could not predict) and deliberately not `Enter` or `Escape`, which are the two ways depth changes.
Three movements, three gestures. An arrow key never leaves the page.

## Keyboard

- `↑` `↓` `←` `→` — move the selection within the grid, the header card included. Depth is not on
  an axis
- `Enter` — descend into the selected card
- `PageUp` / `PageDown` — the previous / next page of this Step
- `Space` — cycle the selected card's status. Not `Enter`, which descends here; `Space` is bound
  nowhere else and reads as a toggle rather than a move
- `E` — open the selected card's editor
- `B` / `A` / `W` — backlog, agentic, asynchronous, the same bare letters the other views bind
- `Escape` — deselect; `F` with nothing selected — the board alone
- `Ctrl+=` / `Ctrl+-` — card size
- `Alt+A`/`Alt+P`/`Alt+S`/`Alt+D`/`Alt+B` — the shared status presets
- `Ctrl+Z` / `Ctrl+Shift+Z` — undo and redo
- `Ctrl+O`, `Shift+Escape`, `Ctrl+Escape`, `Alt+F` — [global bindings](tabs.md): they act on the
  tab's subtree root and filter set, which every view shares

**`Ctrl+S` shows this view**, from wherever you are — see the switcher in [Tabs](tabs.md). It was
held for Steps from the moment the switcher was designed, which is the scheme working as intended:
a fourth view cost one binding.

## What this view does not do

- **Drag and drop between Steps**, and **multi-selection**.
- **Editing in a card.** `E` is the one editing surface.
- **A free-text description on kinds that have none**, as above.
- **Folding passed Habit iterations**, as above.

Ordering follows the same sibling position the other views use.

---
