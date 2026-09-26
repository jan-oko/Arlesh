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
Task, an Info note and a Habit occurrence all open on an *empty* Step that offers to create
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
there out loud (`E`, `Space`, `B`/`A`/`W`, `Enter`, every create and `Delete`), because a *selected* card that answers nothing
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

**The kind is not written out where the glyph already says it** — which is every kind but two. A
Flow's template **Goal** and **Task** are drawn with the Goal and Task glyphs, so on them the words
are the only thing telling a template from the real node, and they stay. Everywhere else the kind
line was the glyph again, in capitals. **An Aspect has neither**: it has no glyph (on the Mindmap
it is a coloured block), reserves no empty slot for one, and does not write out its kind. It is known
by its name and by where it sits — the six of them are what the root is made of.

**The selection ring is drawn inside the card** — the accent border, doubled to 2px by an inset
shadow. An outline outside the card was clipped by the card area's `overflow: hidden` along the top
and left of every card in the first row and column, which sit flush against that edge.

An **Expectation card** draws the wait's glyph — a still spinner of short ticks, open at the lower
right, with a check inside once released — so its status is never written out; an archived one
is dimmed and badged like any archived card; its fields are its **Time Scope** and its **Check every**. `Enter`
descends into it like any card, onto its notes, its completed checks and, while one is due, its
open check task. `E` on a check task says it has no editor yet (see [*Expectations*](resources.md));
on a delegated Task's virtual wait or an asynchronous Task's spawned wait it opens the wait's own
Expectation editor, as on any Expectation row (see [Derived nodes](virtual-nodes.md)).

| Kind | Fields, in reading order |
| --- | --- |
| Task · Goal | Time Scope, Plan, On scope exit |
| Commitment | Verdict Window, Time Scope, Plan |
| Expectation | Time Scope, Check every |
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
guarantees `--node-text` against `--node-bg` with a wide margin. That margin carries the primary
text for every aspect in both themes, a pale one like Steel and the Aspect card itself included: for
the six seeded aspects it bottoms out at 8.80:1 in dark (Self) and 10.49:1 in light (Flow). It does
not carry the muted text, whose margin was thin to begin with — see below.

**The strength is per theme, and light takes more.** It began at 16% dark and 11% light, on the
reasoning that a pale wash reads as coloured sooner. On a pale *page* the opposite held: at 11% a
light card measured 1.00–1.05:1 against the page (`--canvas-bg`) and dissolved into it. Light is now
28%, which puts a card at 1.21–1.32:1 against the page (ΔE00 11–19), still with every title at
10.49:1 or better. Dark stays 16%, where the cards already stood off the page.

**Self and Flow take a strength of their own.** They are the two near-neutral aspects (`#bdc3c7` and
`#95a5a6`), and at a shared strength their washes were all but identical — ΔE00 1.9 in dark and 1.0
in light. Self is the lighter hue and reads lighter:

| Theme | Others | Self | Flow | Self − Flow, card | Self − Flow, row |
|---|---|---|---|---|---|
| Dark | 16% | 16% | 8% | ΔE00 5.0, ΔL* 7.2 | ΔE00 5.0, ΔL* 6.9 |
| Light | 28% | 32% | 56% | ΔE00 8.2, ΔL* 11.6 | ΔE00 7.9, ΔL* 10.5 |

In dark each moved only in the direction that raises its own contrast. In light Flow stops at 56%,
where its badges on a List View row are at 3.02:1, just over the 3:1 an icon needs. **Self stays the
least distinct from the page** — ΔE00 3.4 on a card, 4.1 on a row — because Self is the page's own
light grey: darkening it far enough to stand off the page would take it past Flow. Its edge against
the page is mostly the card border.

A node **outside any aspect** keeps the theme's plain card background, and the board's own header
card is not coloured at all.

**The card's muted text is derived from the card, not from the page.** Most of a card's body is
muted — the field labels, the notes, the count — and the app's `--text-secondary` is picked against
the plain background, where in dark it measures 4.71:1: over WCAG AA's 4.5:1, but with no headroom
for a tint underneath. Every aspect pushed it under, Self in dark reaching 3.30:1. So the muted
colour is blended from *this card's* surface toward the primary text, by `--card-text-muted-mix`:
65% in dark, 72% in light, where the stronger wash takes more of its margin. That holds every aspect
over AA in both themes — dark bottoms out at 4.74:1 on a card (4.53:1 on a row), light at 5.23:1 on
a card (5.03:1 on a row).

**The title line is toned into the card, not laid over it.** The glyph and the title were the only
things on a card at the theme's full text colour — the glyph a solid shape, the title semibold — so
against a washed card the top line read as a separate band, most of all in light. Now the glyph is
drawn in the card's muted colour (4.74:1 at worst, over the 3:1 an icon needs), and the title and the
field values in the card's **strong** colour, derived like the muted one but 85% of the way to the
primary text: 6.87:1 at worst on a card in dark (Self) and 7.44:1 in light (Flow), at medium weight
rather than semibold. The List View's rows do not take this: a row is one line whose title is its
content, at regular weight, with no body under it for a title line to stand apart from.

The **badge icons** are the one thing on the card not derived from it: the badge row is shared with
the List View and draws in `--node-text-muted` and `--danger`. As graphics they answer to WCAG's 3:1
for non-text rather than 4.5:1.

- **Dark**: on a card they clear it on every seeded aspect, with the least room on Self — the danger
  mark 3.01:1, the muted marks 3.30:1. **On a List View row the danger mark does not clear it**: on
  the raised row surface a Self row gives 2.83:1. That is an open contrast gap, recorded rather than
  fixed here; the badge colours are shared by every surface.
- **Light**: every aspect clears it on cards and rows; the least room is a Flow row, with the muted
  marks at 3.02:1 and the danger mark at 3.13:1.

**The fill says nothing about state**, deliberately. That is only safe because the glyph and the
badge row already do: the Task and Goal icons draw their status and their blocked-ness, the
Commitment shield draws its Verdict, and the badge row carries archived, frozen, backlogged, agentic
and asynchronous. It is the same reasoning that took those out of the card's fields — with state
covered twice over, the fill is free to spend itself on *where* the node lives, which nothing else
on the card says.

The **List View's rows take the same wash**, from the same shared stylesheet
(`src/styles/aspect-wash.module.css`), so a Task reads as the same part of the board on either
surface (see [List View](list-view.md)), and so do the [Plan View](plan-view.md)'s cards. None of
them fades the colour by depth; the Mindmap still does.

## Editing

**Cards are read-only**, apart from naming a card just created. `E` opens the real editor, exactly
as elsewhere — one editing surface, not two, and inspecting and descending stay different gestures.
Status cycling and the flag keys still act on the selected card, as they do on a Mindmap node.

Because a Steps card is any kind at all, the editor fan-out every view used to carry its own copy of
is now one shared component: the List View and the Plan View could get away with two kinds each
because a row there is only ever a Task or a Commitment, and that is what stopped being true here.

**Two kinds have no editor at all** — an Aspect, which is fixed, and a folded run of Habit history,
which is a drawing. `E` on one of them is **refused out loud**. A Habit occurrence opens the editor
of its kind, like any row ([Derived nodes](virtual-nodes.md)). That it is one named predicate rather than a
silent `return` in the gesture and a `null` branch in the modal matters: two encodings of the one
fact is how this view shipped a card that set the editor open, drew no modal, and left the keyboard
captured with nothing on screen to release it.

An **empty Step offers to create the first child**, which arrives through the parent's own default
child kind and opens straight into its editor to be named.

### Creating and deleting

**The Mindmap's chords, through the Mindmap's actions.** `Tab`, `Shift+Enter`, `Ctrl+Enter`, the
seven `Shift`+initial chords and `Delete` are bound here and hand the selected card to
`useNodeActions`, the same hook the Mindmap calls. So the type rules, the parent rules, every
refusal (an Aspect, a Habit repetition, a Tag's default child, a kind the parent cannot hold) and
the undo Gestures come with them rather than being restated; one `Ctrl+Z` takes back a create or a
delete made here. `Shift+F` and `Shift+C` open the blank Flow and Commitment editors, shared with the
Mindmap through `useCreateEditors`, because those two kinds are configured before they exist.

**Where the new node goes is the Mindmap's answer, and Steps only decides what you see.**

| Selected | `Shift+Enter` (sibling) | `Ctrl+Enter` (insert parent) | `Tab`, `Shift`+initial (child) |
|---|---|---|---|
| A card | A card beside it, on this Step | A card on this Step, with the selected card moved inside it | A child of the card — so the view **steps into that card** to show it |
| The header card | Refused: it would land outside this Step | Refused: likewise | A card on this Step |
| The board's own card | Refused, as every gesture is there | Refused | Refused |
| Nothing | Nothing | Nothing | `Shift`+initial: that kind on this Step, as with the header card selected (refused on the board). `Tab`: nothing |

Stepping in on a child is the Mindmap reading taken literally — `Tab` makes a child of what is
selected — with the one move that puts the result on screen. It happens only once the create has
succeeded, so a refused create leaves you where you were. A new card is **selected with its title
open for naming**, as on the other views: `Enter` or leaving the field keeps the name, `Escape`
leaves the card untitled, as on the Mindmap. A Flow or Commitment made through its editor is not
selected afterwards, which is also the Mindmap's behaviour.

**Delete** acts on the selected card after the confirmation the other views raise, taking the card's
subtree with it. The selection then lands on the **next card, or the one before** when the last
went — the List View's rule, from the same helper. The Step you are standing on is refused (climb
out first), and so is the board.

**The page follows the selection.** The page shown is the one holding the selected card; with
nothing on the Step selected, it is the page you turned to. That is what puts a new card — appended,
so usually on the last page — on screen, and what goes back a page when a delete empties the one you
were on.

With **nothing selected**, the `Shift`+initial chords still act: naming a kind is enough to say
where it goes, which is onto the Step you are looking at — the same result as selecting the header
card first. The chords that name no kind (`Tab`, `Shift+Enter`, `Ctrl+Enter`, `Delete`) do nothing
then, as on the Mindmap, since there is no card for them to be aimed at. Like every view binding,
none of them fires while a text field has focus or a menu is open.

**The Step's "+"** sits beside the header card and opens a short menu of the kinds this Step's node
can hold — asked of the node, as the chords' refusal is, so it never offers something the create
would refuse — each with its `Shift`+initial chord beside it. Choosing one is the chord, with
nothing selected. A menu rather than one fixed kind because a Step can be a Domain, a Goal or a Tag,
and they hold different things; the List View's `+` makes a Task only because a list row is only
ever one. It is a button, so `Tab` reaches it, and the menu is driven by the arrows, `Enter` and
`Escape`. It is **not drawn on the board**, where nothing can be created. It sits outside the header
card rather than inside it because a card clips what overflows it, and the menu drops below.

## Filtering

A Step honours the tab's shared filter and status preset, so it shows the set the other three views
would show. The node you are standing on is read from the **unfiltered** tree: it is what you walked
to, so the filter never takes it out from under you.

The **focus exemption** applies as it does elsewhere: the selected card stays on the Step even once
your own edit stops it matching, so cycling a Task to Done under **Plan** does not erase it from
under the cursor.

## Pages and zoom

A wide Step **paginates** rather than scrolling. **Card size is a per-tab zoom** with five levels,
set on the settings modal's Steps page (and on `Ctrl+=` / `Ctrl+-`), the way the branch axis is set
on its Mindmap page: one tab walking a wide branch wants small cards while another reads one Task's
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
  nowhere else and reads as a toggle rather than a move. On an **Expectation** it releases the wait
  or takes the release back, and on its check task it completes the check (or reopens a done one).
  Neither has a key of its own: `D` and `L` were removed by the user on 2026-09-24 as proxies for
  this one
- `Shift+W` — on a Task card, open its editor at the Expectation section with Asynchronous on, as on the Mindmap
- `E` — open the selected card's editor
- `Tab`, `Shift+Enter`, `Ctrl+Enter`, `Shift+D`/`P`/`G`/`T`/`C`/`E`/`I`/`F` — create, as above
  (`Shift+E` an **Expectation**); the
  `Shift`+initial chords also with nothing selected, onto this Step
- `Delete` — delete the selected card, after confirming
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
- **Editing in a card**, beyond naming one just created. `E` is the one editing surface.
- **Pasting, and moving cards between Steps.**
- **A free-text description on kinds that have none**, as above.
- **Folding passed Habit iterations**, as above.

Ordering follows the same sibling position the other views use.

---
