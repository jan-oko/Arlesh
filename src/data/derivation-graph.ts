/**
 * The derivation graph shown in Help: every stored input, derived state and preset the app computes
 * from, and the arrows between them. This is the one place the graph lives — the nodes, the edges,
 * the concept cards and the per-node notes. It replaces the standalone HTML graph page.
 *
 * The prose here is English and is rendered as data, not through i18next: it describes the model,
 * and it is written for the people who maintain the model. **Keep it in step with the code**, as
 * `docs/model-map.md` and `docs/model-map.html` are (see `AGENTS.md`).
 */

/** How a box is drawn and what it is: a stored input, a state derived on load, or a preset. */
export type GraphNodeKind = "in" | "dv" | "rd";

/** One box of the graph. */
export interface GraphNode {
  id: string;
  label: string;
  /** The layout column, 0 (stored inputs) to 5 (presets). */
  col: number;
  /** The layout row within the column. */
  row: number;
  kind: GraphNodeKind;
  text: string;
  /** The spec file, with an optional anchor, under `docs/spec/`. */
  spec: string;
}

/** An arrow: `from` is read by `to`. A far arrow reads a value on a different node. */
export interface GraphEdge {
  from: string;
  to: string;
  far: boolean;
}

/** A concept card of the map page. */
export interface GraphCard {
  is: string;
  why: string;
  without: string;
  lives: string;
}

/** Why a box exists, what breaks without it, and where it lives in the code. */
export interface GraphNote {
  why: string;
  without: string;
  lives: string;
}

/** The x of each column, and the width of its boxes. */
export const GRAPH_COLUMN_X: readonly number[] = [16,252,466,680,894,1092];
export const GRAPH_COLUMN_WIDTH: readonly number[] = [176,168,168,168,162,150];
/** Row pitch, top margin and box height, in graph units. */
export const GRAPH_ROW_PITCH = 34;
export const GRAPH_TOP = 22;
export const GRAPH_BOX_HEIGHT = 26;
/** The graph's drawing size. */
export const GRAPH_VIEWBOX = { width: 1260, height: 810 } as const;

export const GRAPH_KIND_LABEL: Readonly<Record<GraphNodeKind, string>> = {"in":"Stored input","dv":"Derived on every load","rd":"Preset"};

export const GRAPH_NODES: readonly GraphNode[] = [
  { id: "now", label: "Now (02:00 day)", col: 0, row: 0, kind: "in", text: "The reference instant every derivation reads. Days, weeks and months turn over at 02:00, not midnight.", spec: "time-scopes.md#the-day-boundary" },
  { id: "ts", label: "Time Scope", col: 0, row: 1, kind: "in", text: "When the item matters: its own window, or the nearest scoped ancestor's.", spec: "time-scopes.md#time-scope-relevance" },
  { id: "exit", label: "On scope exit", col: 0, row: 2, kind: "in", text: "Keep Overdue or Archive: what happens to unfinished work once its window passes. Inherited with the window.", spec: "time-scopes.md#on-exit-behavior-timing-resolution-archival-and-the-overdue-flag" },
  { id: "duex", label: "Explicit due", col: 0, row: 3, kind: "in", text: "A due set on the Task itself. It always wins over the default.", spec: "time-scopes.md#due-scope-and-the-overdue-flag" },
  { id: "plan", label: "Plan", col: 0, row: 4, kind: "in", text: "The slot the Task is scheduled into, inside its window. Tasks only.", spec: "time-scopes.md#plan-scheduling" },
  { id: "backlog", label: "Stored archival", col: 0, row: 5, kind: "in", text: "A Task's stored Archival (Live, Backlog, or Archived by hand: one value), a Commitment's hand archive, a wait's archive. Stored beside the real status.", spec: "resources.md#archive" },
  { id: "gstatus", label: "Goal / Project / Domain status", col: 0, row: 6, kind: "in", text: "Frozen or Archived set by hand on a Goal or Project, or Archived on a Domain.", spec: "resources.md#goals" },
  { id: "delegate", label: "Delegate", col: 0, row: 7, kind: "in", text: "The Person a Task is handed to. Not archival: the Delegated pill decides where a delegated Task shows.", spec: "resources.md#tasks" },
  { id: "status", label: "Status", col: 0, row: 8, kind: "in", text: "Where the work stands, in the ordinary model (To Do, In Progress, Started, Done) or the Agentic one (To Do, On Agent, Doing, Done). Dashed arrows from here read a dependency target's status.", spec: "resources.md#tasks" },
  { id: "subs", label: "Compound, sub-items", col: 0, row: 9, kind: "in", text: "Whether a Task is Compound, and the items beneath it: Tasks, Goals, waits and Commitments in its whole subtree. Any Task with items beneath it reads them.", spec: "resources.md#tasks" },
  { id: "aflag", label: "Agentic flag (own)", col: 0, row: 10, kind: "in", text: "Yes, No or unset on the Task itself. Unset reads the nearest flagged ancestor.", spec: "link-inheritance.md" },
  { id: "question", label: "Agent question waits", col: 0, row: 11, kind: "in", text: "Pending, live agentic waits raised as questions under a Task.", spec: "mcp-server.md#agentic-waits" },
  { id: "claim", label: "Agent Claims", col: 0, row: 21, kind: "in", text: "Each attached Agent's Claim: a subtree, active or paused. Only one active Claim may cover any node.", spec: "agents.md#claims" },
  { id: "usage", label: "Account usage, locks", col: 0, row: 22, kind: "in", text: "The last report of each plan limit window per account, and the manual locks on agents and accounts.", spec: "agents.md#capacity-per-account" },
  { id: "agentcap", label: "Agent at capacity", col: 1, row: 22, kind: "dv", text: "Locked by hand, its account locked, or a window of its account at 100% before its reset. Lifts at the reset by itself.", spec: "agents.md#capacity-per-account" },
  { id: "clock", label: "Clock, miss policy", col: 0, row: 13, kind: "in", text: "Window (Archive, Overdue or Owed) or Interval. Decides what a missed iteration becomes and its default due.", spec: "habits.md#clocks" },
  { id: "cool", label: "Cooldown", col: 0, row: 14, kind: "in", text: "N units a Window Habit rests after an iteration is done.", spec: "habits.md#cooldown" },
  { id: "verdict", label: "Verdict, its window", col: 0, row: 15, kind: "in", text: "A Commitment's Kept, Broken or Unresolved, and how long past its window an answer is still owed.", spec: "resources.md#commitments" },
  { id: "reasons", label: "Block reasons", col: 0, row: 16, kind: "in", text: "Reasons written on a Task or Goal by hand.", spec: "resources.md#tasks" },
  { id: "deps", label: "Dependencies", col: 0, row: 17, kind: "in", text: "Edges from a Task to the Tasks, Goals and stored waits it depends on.", spec: "resources.md#tasks" },
  { id: "pill", label: "On Agent pill", col: 0, row: 18, kind: "in", text: "A filter switch, per tab, asking Start, Do and Zen to show work an agent holds.", spec: "filtering-logic.md" },
  { id: "dpill", label: "Delegated pill", col: 0, row: 19, kind: "in", text: "A tri-state filter pill, per tab: off drops delegated Tasks under Plan and Start, Include keeps them, Exclude hides them everywhere.", spec: "filtering-logic.md#delegated-pill" },
  { id: "rpill", label: "Review pill", col: 0, row: 20, kind: "in", text: "A filter switch, per tab, offered only in the Zen View: Zen shows Review cards only while it is on. Off by default; Do ignores it.", spec: "zen-view.md" },
  { id: "timing", label: "Timing", col: 1, row: 0.5, kind: "dv", text: "Pending before the window, Active in it, Lapsed after it. Unscoped is always Active.", spec: "time-scopes.md#on-exit-behavior-timing-resolution-archival-and-the-overdue-flag" },
  { id: "due", label: "Effective due", col: 1, row: 3, kind: "dv", text: "The window whose end makes work late: the explicit due; otherwise none while backlogged; otherwise the window under Keep Overdue and none under Archive. A Habit occurrence's default comes from its clock.", spec: "time-scopes.md#due-scope-and-the-overdue-flag" },
  { id: "eplan", label: "Effective Plan", col: 1, row: 4.5, kind: "dv", text: "The Plan a Task reads: its own, else its parent's effective Plan clipped to its own window. It climbs through every kind; a wait, a check task and an Overdue Task do not clip. Flagged when an own Plan leaves it, or when nothing of it meets the window.", spec: "time-scopes.md#plan-inheritance" },
  { id: "planpos", label: "Plan position", col: 2, row: 4.5, kind: "dv", text: "Whether the Task's effective Plan is still ahead, current or past, read like Timing.", spec: "filtering-logic.md" },
  { id: "agentic", label: "Agentic (inherited)", col: 1, row: 10, kind: "dv", text: "Whether a Task reads as Agentic: its own flag, else its nearest flagged ancestor's. It picks the status model and what the MCP may write.", spec: "link-inheritance.md" },
  { id: "expired", label: "Expired", col: 1, row: 15, kind: "dv", text: "A Commitment still Unresolved once its Verdict Window has run out. Only Archival moves; the verdict stays Unresolved.", spec: "resources.md#commitments" },
  { id: "resolution", label: "Resolution", col: 2, row: 1.5, kind: "dv", text: "How a passed window settled an item: Completed if it was done, Missed if unfinished under Archive. Nothing under Keep Overdue.", spec: "time-scopes.md#on-exit-behavior-timing-resolution-archival-and-the-overdue-flag" },
  { id: "compound", label: "Compound status", col: 2, row: 9, kind: "dv", text: "Done when every counted sub-item is Done; else In Progress if any is; else Started if any is Started or Done; else To Do. Effectively archived sub-items are not counted, except those archived by finishing. A Task that is not Compound reads the same as a floor under its own status (never Done by itself); a Compound Task that reads as Agentic shows Doing, Review or On Agent by who holds its items.", spec: "resources.md#tasks" },
  { id: "review", label: "Review", col: 2, row: 11, kind: "dv", text: "An On Agent Task with an open agent question beneath it. Never stored; answering returns it to On Agent.", spec: "resources.md#agentic-statuses" },
  { id: "capblock", label: "Capacity block", col: 2, row: 12.3, kind: "dv", text: "While an Agent is at capacity, every Task in its active Claim that reads as Agentic and is not Done carries the derived reason Agents at capacity. There is no app-wide lock.", spec: "mcp-server.md#agent-capacity" },
  { id: "archived", label: "Archived", col: 3, row: 6, kind: "dv", text: "What the presets treat as archived: effective Archival is Archived (forced by a Completed or Missed Resolution, a Missed Habit iteration, a settled or Expired Commitment, a released wait whose window has passed, or set by hand), or an ancestor Task or Commitment was archived by hand, which its whole subtree inherits. Delegation is not archival.", spec: "time-scopes.md#on-exit-behavior-timing-resolution-archival-and-the-overdue-flag" },
  { id: "compblock", label: "Compound block", col: 3, row: 9.6, kind: "dv", text: "A Compound Task is blocked when every one of its open counted items is blocked. A pending wait or an Unresolved Commitment keeps it unblocked.", spec: "resources.md#tasks" },
  { id: "iter", label: "Habit iteration", col: 3, row: 12.6, kind: "dv", text: "Whether an iteration resolved (every template occurrence settled: a Task or Goal done, a compound one by its derived status, a Commitment item given a verdict, a wait item released) and, if not, what the clock makes it: Lapsed, Missed and carried, Owed, or Interval-open. It also sets an occurrence's default due.", spec: "habits.md" },
  { id: "cooldown", label: "Cooldown block", col: 3, row: 14.4, kind: "dv", text: "After an iteration is done, the next one is blocked until the cooldown passes; under Owed, every open iteration. It counts from the latest done instant.", spec: "habits.md#cooldown" },
  { id: "overdue", label: "Overdue", col: 4, row: 3.6, kind: "dv", text: "Unfinished, not effectively archived, and now is past the end of the effective due. Shown as an amber border.", spec: "time-scopes.md#due-scope-and-the-overdue-flag" },
  { id: "blocked", label: "Blocked", col: 4, row: 13.6, kind: "dv", text: "Any reason at all: one written by hand, a dependency whose target is not Done, Achieved or Released, or a derived block (capacity, cooldown, compound). Blocks gate starting; they never change a status.", spec: "resources.md#tasks" },
  { id: "pplan", label: "Plan preset", col: 5, row: 4.5, kind: "rd", text: "Hides done Tasks, archived items, backlogged Tasks, and delegated Tasks unless the Delegated pill includes them.", spec: "filtering-logic.md" },
  { id: "start", label: "Start preset", col: 5, row: 8, kind: "rd", text: "What can be begun now: drops blocked subtrees, Pending and Lapsed windows unless Overdue, backlogged work, delegated work unless the Delegated pill includes it, Plans still ahead, and On Agent work unless the pill asks. Always keeps Review.", spec: "filtering-logic.md" },
  { id: "pdo", label: "Do preset / Zen", col: 5, row: 11.5, kind: "rd", text: "What is under way: In Progress and Doing, Review always, Started and On Agent only when their switches ask. Zen drops Review unless its own Review pill is on.", spec: "zen-view.md" },
  { id: "pbacklog", label: "Backlog preset", col: 5, row: 15, kind: "rd", text: "Only what was deliberately set aside, together with everything beneath it. The inverse of the other presets.", spec: "filtering-logic.md" },
];

export const GRAPH_EDGES: readonly GraphEdge[] = [
  { from: "ts", to: "timing", far: false },
  { from: "now", to: "timing", far: false },
  { from: "duex", to: "due", far: false },
  { from: "ts", to: "due", far: false },
  { from: "exit", to: "due", far: false },
  { from: "backlog", to: "due", far: false },
  { from: "iter", to: "due", far: false },
  { from: "plan", to: "eplan", far: false },
  { from: "ts", to: "eplan", far: false },
  { from: "eplan", to: "planpos", far: false },
  { from: "now", to: "planpos", far: false },
  { from: "aflag", to: "agentic", far: false },
  { from: "verdict", to: "expired", far: false },
  { from: "ts", to: "expired", far: false },
  { from: "now", to: "expired", far: false },
  { from: "timing", to: "resolution", far: false },
  { from: "status", to: "resolution", far: false },
  { from: "exit", to: "resolution", far: false },
  { from: "subs", to: "compound", far: false },
  { from: "archived", to: "compound", far: true },
  { from: "agentic", to: "review", far: false },
  { from: "status", to: "review", far: false },
  { from: "question", to: "review", far: false },
  { from: "agentic", to: "capblock", far: false },
  { from: "status", to: "capblock", far: false },
  { from: "usage", to: "agentcap", far: false },
  { from: "now", to: "agentcap", far: false },
  { from: "agentcap", to: "capblock", far: false },
  { from: "claim", to: "capblock", far: false },
  { from: "backlog", to: "archived", far: false },
  { from: "gstatus", to: "archived", far: false },
  { from: "status", to: "archived", far: false },
  { from: "resolution", to: "archived", far: false },
  { from: "expired", to: "archived", far: false },
  { from: "verdict", to: "archived", far: false },
  { from: "timing", to: "archived", far: false },
  { from: "iter", to: "archived", far: false },
  { from: "compound", to: "compblock", far: false },
  { from: "blocked", to: "compblock", far: true },
  { from: "status", to: "iter", far: false },
  { from: "verdict", to: "iter", far: false },
  { from: "compound", to: "iter", far: false },
  { from: "clock", to: "iter", far: false },
  { from: "now", to: "iter", far: false },
  { from: "iter", to: "cooldown", far: false },
  { from: "cool", to: "cooldown", far: false },
  { from: "clock", to: "cooldown", far: false },
  { from: "now", to: "cooldown", far: false },
  { from: "due", to: "overdue", far: false },
  { from: "status", to: "overdue", far: false },
  { from: "archived", to: "overdue", far: false },
  { from: "now", to: "overdue", far: false },
  { from: "reasons", to: "blocked", far: false },
  { from: "deps", to: "blocked", far: false },
  { from: "status", to: "blocked", far: true },
  { from: "capblock", to: "blocked", far: false },
  { from: "cooldown", to: "blocked", far: false },
  { from: "compblock", to: "blocked", far: false },
  { from: "status", to: "pplan", far: false },
  { from: "archived", to: "pplan", far: false },
  { from: "backlog", to: "pplan", far: false },
  { from: "delegate", to: "pplan", far: false },
  { from: "dpill", to: "pplan", far: false },
  { from: "timing", to: "start", far: false },
  { from: "overdue", to: "start", far: false },
  { from: "archived", to: "start", far: false },
  { from: "blocked", to: "start", far: false },
  { from: "planpos", to: "start", far: false },
  { from: "status", to: "start", far: false },
  { from: "review", to: "start", far: false },
  { from: "agentic", to: "start", far: false },
  { from: "pill", to: "start", far: false },
  { from: "backlog", to: "start", far: false },
  { from: "delegate", to: "start", far: false },
  { from: "dpill", to: "start", far: false },
  { from: "status", to: "pdo", far: false },
  { from: "review", to: "pdo", far: false },
  { from: "agentic", to: "pdo", far: false },
  { from: "pill", to: "pdo", far: false },
  { from: "rpill", to: "pdo", far: false },
  { from: "backlog", to: "pbacklog", far: false },
];

/** The map page's concept cards, by name. */
export const GRAPH_CARDS: Readonly<Record<string, GraphCard>> = {
  "Node kinds": {"is":"Six fixed Aspects at the top, then Projects, Domains and Tags to organise; Goals (desired states), Tasks (actions), Commitments (rules you keep or break), Expectations (waits) and Infos (notes).","why":"Each kind answers a different question: do it, reach it, keep it, wait for it. Each resolves its own way.","without":"One \"item\" type with a flag for every behaviour; a Goal could be ticked off like a chore.","lives":"one table per kind; domains/ · tasks/ · infos/ · ADR 0005"},
  "The parent tree": {"is":"Every node has exactly one parent. The tree is the board: views draw it, and context flows down it.","why":"Windows, the Agentic flag, privacy and archival all reach children through it, so a branch is set once.","without":"Every node carries all its own context, and moving a branch means editing every row in it.","lives":"parent_type / parent_id on each kind; tasks/ancestry.rs"},
  "Flows and Habits": {"is":"A Flow is a template of Task, Goal, Commitment and wait items placed relatively in time. Starting it copies real nodes. A Habit is a Flow with a Recurrence: its instances are derived, never copied.","why":"Repeated structure without retyping it, and recurring work without a growing pile of rows.","without":"Weekly chores retyped every week, or thousands of stored copies a daily habit would leave behind.","lives":"flows/ (template.rs, habits.rs, rules/items.rs) · ADR 0002"},
  "Overlays": {"is":"The difference between one Habit occurrence and its template: a status, a done time, any field edited on that one occurrence. An empty column means \"as the template says\".","why":"Storage grows with what you change, not with how many weeks pass, and editing the template still reaches every untouched occurrence.","without":"Touching an occurrence would freeze a full copy, cut off from later template edits.","lives":"task_/goal_/commitment_/expectation_overlays; nodes/overlay.rs"},
  "Derived nodes": {"is":"Habit occurrences, a wait's check tasks, the wait an Asynchronous Task spawns when done, and the wait a delegated Task has on its person. Each is an ordinary row of its kind with an origin saying why it exists.","why":"Every view, filter and the MCP read one row shape; none needs a second code path.","without":"Each surface special-cases each source, and they drift apart.","lives":"nodes/ (origin, table, waits) · flows/occurrences.rs · ADR 0008"},
  "Three kinds of id": {"is":"A stored row has an integer row id. Every node has a full id, a UUID. A short id is the shortest unique prefix of it, at least three characters, that is never a row id.","why":"Derived rows have no row number, and people need a handle shorter than a UUID that can't be mistaken for a row or PR number.","without":"Two id types in every request, and \"224\" meaning three different things.","lives":"nodes/id.rs · mcp/ids.rs · src/utils/uuid-v5.ts"},
  "Two status models": {"is":"An ordinary Task is To Do, In Progress, Started or Done. A Task that reads as Agentic is To Do, On Agent, Review, Doing or Done. The two are separate types.","why":"The board has to say who holds the work. On Agent is the agent's; Doing is yours.","without":"An agent's work reads as yours, and fills Do and Zen with things you are not doing.","lives":"tasks/model.rs · tasks/rules/gestures.rs · src/utils/status-mapping.ts"},
  "Review": {"is":"Never set: an On Agent Task with an open agent question beneath it. Answering the question puts it back On Agent.","why":"It is the only way an agent hands work back, and the question says what you need to do.","without":"Agent questions scatter as loose waits, and nothing on the Task says it is waiting on you.","lives":"tasks/rules/review.rs · mindmap/rules/facts.rs · src/utils/open-question.ts"},
  "Compound": {"is":"A Task whose status is read off its sub-items: Done when they all are, In Progress or Started as they progress. Never stored, and you cannot set it by hand.","why":"A Task that is just the sum of its steps should never disagree with them.","without":"A parent says Done while a step is open, or To Do after everything finished.","lives":"tasks/compound.rs · flows/compound_readings.rs"},
  "Scopes and the 02:00 day": {"is":"Season, Month, Week (Sunday to Saturday), Day, Part of Day and Exact windows, named by small value keys and never stored. Every canonical scope starts and ends at 02:00.","why":"A Day must contain its own Night (22:00 to 02:00); a scope contains exactly its parts.","without":"Between midnight and 02:00 the Day says \"today\" while its Night says \"yesterday\", and everything derived from it flips early.","lives":"scopes/ (key, derive, resolve) · ADR 0009"},
  "Time Scope and Plan": {"is":"A Time Scope is when something matters; a Plan is the slot you mean to do it in, inside that window. An empty Time Scope inherits the nearest window above, and a Task with no Plan inherits the nearest Plan above, clipped to its own window.","why":"\"Relevant this month\" and \"doing it Tuesday morning\" are different facts that change at different rates.","without":"Either everything is scheduled rigidly or nothing knows when it stops mattering.","lives":"tasks/scope_rules.rs · tasks/rules/plan_inheritance.rs · ADR 0001"},
  "Timing": {"is":"Pending before the window, Active in it, Lapsed after. Worked out from the effective window, own or inherited.","why":"Start should only offer what is in scope now.","without":"Next month's work and last month's both crowd today.","lives":"tasks/rules/lifecycle.rs"},
  "Due and Overdue": {"is":"A due is the window whose end makes work late: one set on the Task, or by default its window under Keep Overdue. Overdue is a flag: unfinished, not archived, past the due's end. It shows as an amber border.","why":"Being late is separate from being relevant; late work stays live.","without":"Lateness had to be a resolution, which settled and hid work that was still open.","lives":"tasks/rules/lifecycle.rs (effective_due, derive_overdue)"},
  "Habit clocks": {"is":"A Window clock lays iterations side by side; a missed one is Archived, carried into the next (Overdue), or left Owed. An Interval clock keeps one open instance and counts the Gap from completion.","why":"Habits fail differently: a missed run is gone, a missed bill is still owed.","without":"One rule that is wrong for half the habits.","lives":"flows/rules/habits.rs · flow_recurrences.clock, miss_policy"},
  "Cooldown and done times": {"is":"A cooldown blocks the next iteration for N units after one is done; under Owed it blocks every open one. Every finish records when it happened, and a Task's done date can be corrected.","why":"Done on Saturday should not count again on Sunday, and a habit ticked late should count from when it was really done.","without":"Back-to-back completions across a window edge, and clocks counting from the moment you remembered to tick.","lives":"flows/rules/cooldown.rs · tasks/done_date.rs"},
  "Resolution": {"is":"How a passed window settled an item: Completed, or Missed under Archive. A Habit iteration resolves when every occurrence its template made is settled: done, compound ones by their derived status, a Commitment item's by a verdict, a wait item's by its release.","why":"A passed window needs an answer, and the Habit clocks count from it.","without":"Old work hangs on with no verdict, and clocks have nothing to count from.","lives":"tasks/rules/lifecycle.rs · flows/occurrences.rs (resolutions)"},
  "Archival and Backlog": {"is":"Live, Backlog, Frozen or Archived. Set by hand (a Goal or Project's status, a Domain's archive; a Task's stored Archival, Live, Backlog or Archived; a Commitment's or wait's own archive), inherited (everything beneath a Task or Commitment archived by hand), or derived: a settled window archives, and so does a released wait whose window has passed. Delegation is not archival: it has its own pill.","why":"\"Set aside\" and \"finished\" are different questions; a backlogged Task keeps its real status. Putting a branch away is one write, and taking it back restores it exactly.","without":"Statuses multiply (\"done-ish\", \"paused-forever\"), every filter has to know them all, and archiving a project means archiving every step in it.","lives":"tasks/rules/lifecycle.rs · tasks/rules/archival.rs · filters/facts.rs"},
  "Commitment verdicts": {"is":"A Commitment is judged, not done: Kept, Broken or still Unresolved. Its Verdict Window bounds how long the answer stays owed; past it, it Expires.","why":"A rule like \"phone off by 23:00\" is kept or broken, and an unanswered night may well have been kept.","without":"A missed check-in would count as a broken commitment.","lives":"tasks/commitments.rs · ADR 0005"},
  "Agentic": {"is":"A three-state flag (unset, yes, no) that inherits down and can be overridden. It decides the status model, and what the MCP may write. Each Agentic Task has its own brief, and needs a Spec before it can start.","why":"Mark a project for agents in one edit, and pull one Task back out of it.","without":"Flagging every Task by hand, and agents writing into your own work.","lives":"tasks/agentic.rs · src/utils/agentic.ts"},
  "Scope containment": {"is":"A child's window sits inside its parent's, a Plan inside its window and inside the Plan it inherits, a due inside its window. Checked on every write; a write that leaves a Task with no Plan inside its window is refused, naming it; narrowing a parent offers to clamp its children (or, for Plans, clear theirs so they inherit).","why":"A step can't matter outside the window of the thing it is a step of.","without":"Children outliving their parents and plans scheduled after the work stopped mattering.","lives":"tasks/scope_rules.rs"},
  "Link inheritance": {"is":"Time Scope, Plan and Agentic inherit today. Asynchronous deliberately does not. Tags, knowledge-base links and delegation are specified to inherit but not built.","why":"Context belongs on the branch; a filter on a parent's tag should find its children.","without":"Re-tagging every child, or filters that miss half a project.","lives":"docs/spec/link-inheritance.md"},
  "Privacy": {"is":"A node's own Private flag hides it and everything beneath it, outside Private Mode and from the MCP even inside its roots.","why":"One switch keeps a whole area out of sight and out of agents' context.","without":"Hiding a subtree node by node, and leaking whatever was missed.","lives":"access/ · mindmap/rules/facts.rs"},
  "Block reasons": {"is":"An ordered list of reasons written on a Task or Goal by hand.","why":"Some obstacles are not on the board (\"waiting for the landlord\").","without":"Blocked work looks startable.","lives":"block_reasons/"},
  "Dependencies": {"is":"A Task can depend on a Task, a Goal or a stored wait. Until it is met, the Task reads \"Blocked by task 6f3 (title)\". Cycles are refused.","why":"Order between pieces of work is a fact worth recording once.","without":"You remember the order yourself, and Start offers things out of turn.","lives":"tasks/mod.rs · mindmap/rules/facts.rs · src/utils/blocked-by.ts"},
  "Derived blocks": {"is":"Blocks no one writes: an Agent at capacity, on the unfinished Agentic Tasks of its Claim, a Habit's cooldown, and a compound Task whose open sub-items are all blocked.","why":"One mechanism, so filters, badges and the MCP need nothing new for each.","without":"A special filter rule per feature, each one missing a view.","lives":"capacity/rules/blocks.rs · flows/rules/cooldown.rs · tasks/compound.rs"},
  "Presets": {"is":"All, Plan, Start, Do, Backlog and Unblock: each a rule over derived facts. Start, for example, drops blocked, pending, lapsed (but not Overdue) and planned-ahead work.","why":"\"What can I begin now?\" should have one answer, everywhere.","without":"Each view invents its own idea of \"now\".","lives":"filters/ (Rust) · src/utils/filter-tree.ts, list-filter.ts"},
  "The conformance pair": {"is":"Every rule the views answer per keystroke or per press has one definition, in a Rust rules module. Most reach the frontend as a TypeScript copy, and one shared case file per rule family runs against both. The rules a press is predicted with (the status step, Alt+Enter, the Compound refusal, the verdict, the parenting table, the Plan View's triage and refusal) are not copied at all: the Rust rule is compiled to wasm and called, and the same case file runs through it.","why":"The views filter instantly on every keystroke, without a round trip; the corpus keeps the copies honest, and the wasm ones have no copy to keep.","without":"The agent's board and yours drift apart silently.","lives":"conformance/ · *-conformance.test.ts · crates/arlesh-rules(-wasm) · src/wasm/ · ADR 0010, ADR 0012"},
  "Pills and the focus exemption": {"is":"Filters combine as Any, All and Not. The selected node stays on screen, dimmed, even after your own edit stops it matching.","why":"Completing a Task under Plan should not make it vanish from under the cursor.","without":"Every edit risks losing your place.","lives":"src/utils/filter-modes.ts, focus-exemption.ts"},
  "Views": {"is":"Mindmap (the tree), List (rows), Plan (triage into scopes), Steps (one level at a time) and Zen (what's in progress). One tree and one filter model under all of them.","why":"Different jobs need different shapes of the same truth.","without":"Five boards to keep in step.","lives":"src/components/*View · docs/spec/*-view.md"},
  "The MCP": {"is":"Agents' door to the board. They see only inside the roots you open, never what is private, and write only Agentic Tasks. They hand work back by asking a question.","why":"A clean, bounded context for an agent, on the same derived board you see.","without":"Agents read everything, or a separate copy that disagrees.","lives":"mcp/ · access/ · capacity/"},
  "The server": {"is":"arlesh-server serves the board over HTTP, as the first step toward multi-device. It runs the core through the Python bindings and adds no rules of its own. Every request carries a bearer token, which names the client the journal records. It serves the MCP at /mcp too, behind its own connect token, and holds the database while it runs, as the app does: it will not start while the app or another server holds it, unless forced.","why":"One copy of the board, reachable from more than one device, with one writer.","without":"The board lives only inside the running app on one machine.","lives":"crates/arlesh-py/python/arlesh/server · arlesh[server]"},
  "Client mode": {"is":"Each device runs Standalone (its own database file, as before) or as a Client of arlesh-server. Every Tauri command goes through one Backend port: SqliteBackend in-process, or HttpBackend calling the server's routes, one per method. The server's change stream reloads every device's windows, undo is per device, and an unreachable server leaves the last board read-only.","why":"One board shared by several devices, with the app itself unchanged above the port.","without":"A second app for the server, or every component taught about HTTP; devices that each hold a different board.","lives":"crates/arlesh-backend/ (sqlite, http) · client_mode/ · conformance/client-mode.json · ADR 0011"},
  "Pending writes": {"is":"An action the board shows before the server answers it: a status step, Alt+Enter, a verdict, a wait release, a rename, an editor's Save, or a new child or sibling. Its patch sets only the node's own fields, never a derived one. The window's pending writes go out one at a time, in order. A pending node pulses faintly until the answer. Each fresh board is drawn with the unanswered patches over it, and a refusal rolls back that patch and every later one on the node, with one toast. A new node gets a temporary id until its create is answered.","why":"In Client mode every write is a round trip and a reload, and a press that shows nothing for that long feels broken.","without":"Every press waits on the network, or the board computes derived values the server never agreed to.","lives":"src/utils/pending-writes.ts · apply-pending-writes.ts · src/stores/use-pending-writes-store.ts · ADR 0012"},
  "The undo journal": {"is":"SQL triggers on every table record each row's before and after. One gesture is one step; Ctrl+Z replays it in reverse, across windows. An agent's or another client's writes are journaled but never undone from the app.","why":"A trigger can't be forgotten by a command that doesn't know it exists.","without":"An inverse to write for every one of eighty-odd commands, and the next one missing it.","lives":"undo/ · scripts/generate-undo-triggers.sh · ADR 0006"},
  "Clients and a second writer": {"is":"Every write is journaled with the client it came through: the app is desktop, and a Python session names itself. The app's Ctrl+Z takes only its own. While the app runs it holds the database, and another writer must force its way in; reading is never refused.","why":"More than one program writes the board now, and each must tell its own changes from another's.","without":"Ctrl+Z in the app would reverse what a script did, and a script could rewrite rows under the app's open windows unwarned.","lives":"database/ (client, hold, open) · migration 0092 · crates/arlesh-py"},
  "Migrations": {"is":"Numbered schema steps, applied in order and never edited once applied. Data is moved aside, never dropped.","why":"Your real database must reach every new shape without losing anything.","without":"Upgrades that refuse to start, or quietly discard history.","lives":"crates/arlesh-core/migrations/"},
  "A truthful board": {"is":"Nothing derived is stored, so nothing derived goes stale. A pending write shows only its own node's own fields, and only until a board that reflects it arrives. Every window hears about every change. An agent whose next step is yours must say so with a question.","why":"You act on what the board says; a board that lies costs more than none.","without":"Stale copies, windows that disagree, and work that looks held when it is waiting on you.","lives":"board.rs (board-changed) · AGENTS.md"},
  "Agents and Claims": {"is":"An MCP session starts unattached and sees nothing. A one-time PIN, or the agent token it was given, makes it an Agent, bound for the connection. An Agent holds one Claim, a subtree inside your roots that is its whole view; only one active Claim covers a node, and a paused one frees the subtree. Agents declare an Account, usage is kept per account, and an Agent is at capacity while a window of its account is full before its reset.","why":"Several agents can work one board without overlapping, each in a bounded context, and one agent reaching its plan limit blocks only its own work.","without":"Every session sees the same roots, two agents write one subtree, and a limit hit by one blocks everyone or no one.","lives":"agents/ · mcp/agents.rs · migration 0101 · ADR 0018"},
};

/** Which concept card on the map page each box belongs to, by node id. */
export const GRAPH_CARD_OF: Readonly<Record<string, string>> = {
  "now": "Scopes and the 02:00 day",
  "ts": "Time Scope and Plan",
  "exit": "Resolution",
  "duex": "Due and Overdue",
  "plan": "Time Scope and Plan",
  "eplan": "Time Scope and Plan",
  "backlog": "Archival and Backlog",
  "gstatus": "Archival and Backlog",
  "delegate": "Archival and Backlog",
  "status": "Two status models",
  "subs": "Compound",
  "aflag": "Agentic",
  "question": "Review",
  "clock": "Habit clocks",
  "cool": "Cooldown and done times",
  "verdict": "Commitment verdicts",
  "reasons": "Block reasons",
  "deps": "Dependencies",
  "pill": "Presets",
  "dpill": "Presets",
  "rpill": "Presets",
  "timing": "Timing",
  "due": "Due and Overdue",
  "planpos": "Time Scope and Plan",
  "agentic": "Agentic",
  "expired": "Commitment verdicts",
  "resolution": "Resolution",
  "compound": "Compound",
  "review": "Review",
  "claim": "Agents and Claims",
  "usage": "Agents and Claims",
  "agentcap": "Agents and Claims",
  "capblock": "Derived blocks",
  "archived": "Archival and Backlog",
  "compblock": "Derived blocks",
  "iter": "Habit clocks",
  "cooldown": "Cooldown and done times",
  "overdue": "Due and Overdue",
  "blocked": "Derived blocks",
  "pplan": "Presets",
  "start": "Presets",
  "pdo": "Presets",
  "pbacklog": "Presets",
};

/** Per-box notes, by node id. */
export const GRAPH_NOTES: Readonly<Record<string, GraphNote>> = {
  "now": {"why":"Every time-based state is read against it, so nothing time-based has to be stored and nothing goes stale overnight.","without":"Timing, Overdue and blocks would be frozen at whenever they were last written.","lives":"the load's `now`; scopes/ day boundary"},
  "ts": {"why":"Says when work stops mattering, separately from when you plan to do it.","without":"Old work never leaves Start, and next month's work crowds today.","lives":"tasks.time_scope_*; tasks/scope_rules.rs"},
  "exit": {"why":"Lets each piece of work say whether lateness keeps it open (Keep Overdue) or lets it lapse (Archive).","without":"Every unfinished item would either nag forever or vanish silently, the same for all.","lives":"tasks.on_scope_exit"},
  "duex": {"why":"Lateness can fall before the end of the window, e.g. due Tuesday inside a week that matters.","without":"Overdue could only ever mean 'the whole window passed'.","lives":"tasks.due_scope_*"},
  "plan": {"why":"Records the slot you mean to work in, apart from the window in which it matters.","without":"Start can't tell work for today from work you scheduled for Thursday.","lives":"tasks.plan_*"},
  "backlog": {"why":"Sets a Task aside, or puts a Task or Commitment away with its whole branch, without lying about its status.","without":"Parked or finished-with work would need a fake status, or would keep showing as if it were live.","lives":"tasks.archival ('live' / 'backlog' / 'archived'), commitments.archival, expectations.archival (migration 0093)"},
  "gstatus": {"why":"Goals and Projects are paused or retired by hand, not by finishing.","without":"A frozen project's work would keep surfacing.","lives":"goals.status, domains.status"},
  "delegate": {"why":"Says someone else holds the work, so the Delegated pill can take it off your board while its wait stays in view.","without":"Handed-off work keeps showing as yours to start.","lives":"tasks.delegate_kind, delegate_id"},
  "status": {"why":"Where the work stands, the one fact most other states start from.","without":"Nothing could tell done from not done.","lives":"tasks.status; tasks/model.rs"},
  "subs": {"why":"Marks a Task as the sum of its steps, and supplies the steps.","without":"A parent's status would have to be kept in step with its children by hand.","lives":"tasks.compound; the subtree"},
  "aflag": {"why":"One edit marks a branch for agents; an explicit No pulls a Task back out.","without":"Every Task would need flagging one by one.","lives":"tasks.agentic (NULL / 1 / 0)"},
  "question": {"why":"An agent's only way to hand work back with the reason attached.","without":"Agents have no visible way to say 'your turn, and here is why'.","lives":"expectations (agentic, question); arlesh_waits.ask"},
  "clock": {"why":"Habits fail differently, so each says how a miss counts.","without":"One miss rule for every habit, wrong for half of them.","lives":"flow_recurrences.clock, miss_policy"},
  "cool": {"why":"Some habits need rest between runs, not just one per window.","without":"Saturday's run followed by Sunday's counts as two.","lives":"flow_recurrences.cooldown_n, cooldown_kind"},
  "verdict": {"why":"A Commitment is judged, and an answer can be owed for a while after its window.","without":"Commitments could only be done or not done, like chores.","lives":"commitments.verdict, verdict_window_*"},
  "reasons": {"why":"Records obstacles that are not on the board.","without":"Work blocked by something outside looks startable.","lives":"block_reasons"},
  "deps": {"why":"Records order between pieces of work once.","without":"You keep the order in your head, and Start offers work out of turn.","lives":"task_dependencies"},
  "pill": {"why":"Lets you look at what agents hold without it filling your own views by default.","without":"Agent work is either always in Start and Do, or never visible there.","lives":"per-tab filter state (showOnAgent)"},
  "timing": {"why":"Answers 'is this in scope right now', which Start depends on.","without":"Start shows next month's and last month's work beside today's.","lives":"tasks/rules/lifecycle.rs::derive_timing"},
  "due": {"why":"Turns the explicit due, window, on-exit choice, Backlog and Habit clock into one deadline.","without":"Each reader would re-derive lateness its own way and disagree.","lives":"tasks/rules/lifecycle.rs::effective_due; flows/occurrences.rs::default_due"},
  "planpos": {"why":"Lets Start hide work scheduled for later without hiding work that missed its slot.","without":"Thursday's work shows today, or a missed slot hides the work.","lives":"lifecycle plan_timing; filters/rules.rs::is_planned_ahead"},
  "agentic": {"why":"Settles once per Task which status model it uses and whether agents may write it.","without":"Every reader climbs the tree itself, and some get it wrong.","lives":"tasks/agentic.rs"},
  "expired": {"why":"Closes the question on an unanswered Commitment without pretending it was broken.","without":"Unanswered commitments pile up forever, or get marked Broken.","lives":"tasks/rules/lifecycle.rs::verdict_deadline"},
  "resolution": {"why":"Gives a passed window an answer: finished in time, or missed.","without":"Old work never settles, and nothing knows to archive it.","lives":"tasks/rules/lifecycle.rs::derive_resolution"},
  "compound": {"why":"Keeps a parent's status equal to what its steps say.","without":"A parent says Done while a step is open.","lives":"tasks/compound.rs; flows/compound_readings.rs"},
  "review": {"why":"Makes 'the agent is waiting on you' a status you can see and filter on.","without":"Questions hide as loose waits, and the Task still looks like the agent's.","lives":"tasks/rules/review.rs"},
  "capblock": {"why":"Turns an agent's capacity into an ordinary block, so every reader honours it unchanged.","without":"A special filter rule for capacity, missing from some view.","lives":"capacity/rules/blocks.rs"},
  "archived": {"why":"One answer to 'is this out of play', whatever put it there, a hand archive above it included.","without":"Each preset tests settled windows, Frozen, Backlog, released waits and hand archives separately, and some forget one.","lives":"tasks/rules/lifecycle.rs::derive_archival; tasks/rules/archival.rs::inherit; filters/rules.rs::is_archived"},
  "compblock": {"why":"A compound can't move if none of its open steps can.","without":"Start offers a compound whose every step is stuck.","lives":"tasks/compound/blocked.rs"},
  "iter": {"why":"Decides per iteration whether it's done, missed, carried or still owed, and when its next one comes.","without":"Habits have no notion of a missed run or a carried debt.","lives":"flows/occurrences.rs::resolutions; flows/rules/habits.rs"},
  "cooldown": {"why":"Turns 'rest after a run' into an ordinary block that lifts on its own.","without":"Moving windows around instead, which shifted dues and keys.","lives":"flows/rules/cooldown.rs::holds"},
  "overdue": {"why":"Flags late work while keeping it live and visible.","without":"Late work either lapses quietly or looks on time.","lives":"tasks/rules/lifecycle.rs::derive_overdue"},
  "blocked": {"why":"One answer to 'can this start', from any cause.","without":"Every view checks reasons, dependencies and each derived block on its own.","lives":"filters/facts.rs::index_blocked; filters/rules.rs::is_blocked"},
  "pplan": {"why":"Shows everything still to be planned: open, unarchived work, including what is blocked or scheduled later.","without":"Nothing shows all the open work at once, so planning ahead only sees what Start lets through.","lives":"filters/rules.rs::passes_plan"},
  "start": {"why":"Answers 'what can I begin now', hiding blocked, pending, lapsed, delegated and planned-ahead work while keeping Overdue and Review.","without":"Picking the next thing means wading through work you can't or shouldn't touch yet.","lives":"filters/rules.rs::passes_start, passes_agentic_start, gate_below"},
  "pdo": {"why":"Shows only what is in hand: In Progress and Doing, plus Review waiting on you. Zen is built on it.","without":"No focused view of current work; what you're doing drowns among what you could do.","lives":"filters/rules.rs::passes_do_status; ZenView"},
  "pbacklog": {"why":"The inverse of the others: only what was deliberately set aside, with everything beneath it, so parked work can be reviewed and revived.","without":"Backlogged work is hidden from Plan and Start with nowhere to find it again.","lives":"filters/rules.rs::passes_status (Backlog)"},
  "rpill": {"why":"Lets the Zen View keep to the work in hand, with the agents' questions a pill away.","without":"Every open question sits at the head of the focus grid whether or not you are answering questions now.","lives":"per-tab filter state (showReview); filters/zen.rs::contents"},
  "dpill": {"why":"Lets you choose whether work someone else holds shows in Plan and Start, or anywhere at all.","without":"Delegated work is either always hidden with the archived, or always mixed into your own.","lives":"per-tab filter state (delegatedMode); filters/rules.rs::is_dropped_for_delegation"},
  "claim": {"why":"Bounds what each agent sees and writes, and keeps two agents out of one subtree.","without":"Every session sees all the roots and can overwrite another agent's work.","lives":"agents table; arlesh_agents"},
  "usage": {"why":"Capacity is a fact about an account's plan, not about the whole board.","without":"One global lock: one agent at its limit blocks everyone, and it has to be cleared by hand.","lives":"agent_account_usage, agent_accounts, agents.locked"},
  "agentcap": {"why":"Derived from the reports and now, so it lifts at the reset with no timer to miss.","without":"A stored flag that stays stuck when a timer or a client misses the reset.","lives":"agents/rules/usage.rs"},
};
