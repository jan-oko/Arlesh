/**
 * The concept map shown in Help: the prose of how Arlesh fits together, in groups of concept cards,
 * with the derivation graph (`derivation-graph.ts`) and the pipeline diagram in their places.
 * It replaces the standalone `docs/model-map.html`; `docs/model-map.md` stays as the agents' copy.
 *
 * One concept is one entry in a group below: `is`, `why`, `without` and `lives`. A card's
 * title is also what `GRAPH_CARD_OF` (the graph's box-to-concept map) points at, so renaming a card
 * means renaming it there too. In these strings a pair of backticks marks inline code.
 *
 * The text is English and is rendered as data, not through i18next. **Keep it in step with the code
 * and with `docs/model-map.md`** (see `AGENTS.md`).
 */

/** The colour band of a group, mapped to a design token in the stylesheet. */
export type ModelMapBand = "stored" | "derived" | "duty" | "flow" | "growth" | "body" | "read" | "accent";

/** One concept: what it is, why it exists, what would break without it, and where it lives. */
export interface ModelMapCard {
  title: string;
  is: string;
  why: string;
  without: string;
  lives: string;
}

/** A numbered group of concept cards. */
export interface ModelMapGroup {
  id: string;
  number: number;
  /** The short name, used in the jump list and the eyebrow. */
  name: string;
  band: ModelMapBand;
  title: string;
  intro: string;
  cards: readonly ModelMapCard[];
}

export const MODEL_MAP_HEADER = {
  eyebrow: "Arlesh · conceptual model",
  title: "How Arlesh fits together",
  lede: "Arlesh stores very little and derives a great deal. This page is the map: what is written down, what is worked out from it on every load, and how that reaches the screen and the agents. Each card says why a concept exists and what would break without it.",
  note: "It is not the specification. The rules themselves live in `SPEC.md` and `docs/spec/`; an agent-friendly copy of this page, with fuller code pointers, is `docs/model-map.md`.",
} as const;

export const MODEL_MAP_PIPELINE_CAPTION = "One direction of data. Everything in the middle box is recomputed from the stored rows on every load, so nothing derived can go stale. Both the views and the MCP read the same derived board through the same filter definitions, and every edit lands back in a stored row or an overlay.";

export const MODEL_MAP_GRAPH_SECTION = {
  eyebrow: "Derivation graph",
  title: "What each state is worked out from",
  intro: "Stored inputs on the left, states the board load derives in the middle, the presets that read them on the right. Hover, focus or tap a box to see what it is and light up what it reads and what reads it. Click, tap or press Enter to pin its card; pin as many as you like.",
} as const;

export const MODEL_MAP_FOOTER = "Keep this map, `docs/model-map.md` and `src/data/derivation-graph.ts` in step: a change that adds, removes or changes the meaning of a concept updates them in the same pull request, as it updates the spec.";

export const MODEL_MAP_GROUPS: readonly ModelMapGroup[] = [
  {
    id: "stored", number: 1, name: "What's stored", band: "stored",
    title: "The few things written down",
    intro: "Rows of each kind, the tree they hang in, the templates that generate work, and the edits made to generated work.",
    cards: [
      {
        title: "Node kinds",
        is: "Six fixed Aspects at the top, then Projects, Domains and Tags to organise; Goals (desired states), Tasks (actions), Commitments (rules you keep or break), Expectations (waits) and Infos (notes).",
        why: "Each kind answers a different question: do it, reach it, keep it, wait for it. Each resolves its own way.",
        without: "One \"item\" type with a flag for every behaviour; a Goal could be ticked off like a chore.",
        lives: "one table per kind; domains/ · tasks/ · infos/ · ADR 0005",
      },
      {
        title: "The parent tree",
        is: "Every node has exactly one parent. The tree is the board: views draw it, and context flows down it.",
        why: "Windows, the Agentic flag, privacy and archival all reach children through it, so a branch is set once.",
        without: "Every node carries all its own context, and moving a branch means editing every row in it.",
        lives: "parent_type / parent_id on each kind (a domains-table parent always spelled domain; its kind is the row’s subtype); tasks/ancestry.rs",
      },
      {
        title: "Flows and Habits",
        is: "A Flow is a template of Task, Goal, Commitment and wait items placed relatively in time. Starting it copies real nodes. A Habit is a Flow with a Recurrence: its instances are derived, never copied.",
        why: "Repeated structure without retyping it, and recurring work without a growing pile of rows.",
        without: "Weekly chores retyped every week, or thousands of stored copies a daily habit would leave behind.",
        lives: "flows/ (template.rs, habits.rs, rules/items.rs) · ADR 0002",
      },
      {
        title: "Overlays",
        is: "The difference between one Habit occurrence and its template: a status, a done time, any field edited on that one occurrence. An empty column means \"as the template says\".",
        why: "Storage grows with what you change, not with how many weeks pass, and editing the template still reaches every untouched occurrence.",
        without: "Touching an occurrence would freeze a full copy, cut off from later template edits.",
        lives: "task_/goal_/commitment_/expectation_overlays; nodes/overlay.rs",
      },
    ],
  },
  {
    id: "derived", number: 2, name: "What's derived", band: "derived",
    title: "Rows that exist because something else does",
    intro: "Worked out on every load from the stored rows, and treated exactly like stored rows by everything downstream.",
    cards: [
      {
        title: "Derived nodes",
        is: "Habit occurrences, a wait's check tasks, the wait an Asynchronous Task spawns when done, and the wait a delegated Task has on its person. Each is an ordinary row of its kind with an `origin` saying why it exists.",
        why: "Every view, filter and the MCP read one row shape; none needs a second code path.",
        without: "Each surface special-cases each source, and they drift apart.",
        lives: "nodes/ (origin, table, waits) · flows/occurrences.rs · ADR 0008",
      },
      {
        title: "Three kinds of id",
        is: "A stored row has an integer row id. Every node has a full id, a UUID. A short id is the shortest unique prefix of it, at least three characters, that is never a row id.",
        why: "Derived rows have no row number, and people need a handle shorter than a UUID that can't be mistaken for a row or PR number.",
        without: "Two id types in every request, and \"224\" meaning three different things.",
        lives: "nodes/id.rs · mcp/ids.rs · src/utils/uuid-v5.ts",
      },
      {
        title: "Two status models",
        is: "An ordinary Task is To Do, In Progress, Started or Done. A Task that reads as Agentic is To Do, On Agent, Review, Doing or Done. The two are separate types.",
        why: "The board has to say who holds the work. On Agent is the agent's; Doing is yours.",
        without: "An agent's work reads as yours, and fills Do and Zen with things you are not doing.",
        lives: "tasks/model.rs · tasks/rules/gestures.rs · src/utils/status-mapping.ts",
      },
      {
        title: "Review",
        is: "Never set: an On Agent Task with an open agent question beneath it. Answering the question puts it back On Agent.",
        why: "It is the only way an agent hands work back, and the question says what you need to do.",
        without: "Agent questions scatter as loose waits, and nothing on the Task says it is waiting on you.",
        lives: "tasks/rules/review.rs · mindmap/rules/facts.rs · src/utils/open-question.ts",
      },
      {
        title: "Compound",
        is: "A Task whose status is read off its sub-items: Done when they all are, In Progress or Started as they progress. Never stored, and you cannot set it by hand. Any other Task with sub-items reads at least Started or In Progress from them (its own status is raised, never lowered) and cannot be set Done while a counted item is open. A Compound Task that reads as Agentic shows On Agent or Review as its items say.",
        why: "A Task that is just the sum of its steps should never disagree with them, and a parent should not say To Do over work under way or Done over work left.",
        without: "A parent says Done while a step is open, or To Do after everything finished.",
        lives: "tasks/compound.rs · flows/compound_readings.rs",
      },
    ],
  },
  {
    id: "time", number: 3, name: "Time", band: "duty",
    title: "Windows, slots, lateness and clocks",
    intro: "Time is arithmetic over a calendar, not rows in a table. Every time-based state is read off \"now\" at load.",
    cards: [
      {
        title: "Scopes and the 02:00 day",
        is: "Season, Month, Week (Sunday to Saturday), Day, Part of Day and Exact windows, named by small value keys and never stored. Every canonical scope starts and ends at 02:00.",
        why: "A Day must contain its own Night (22:00 to 02:00); a scope contains exactly its parts.",
        without: "Between midnight and 02:00 the Day says \"today\" while its Night says \"yesterday\", and everything derived from it flips early.",
        lives: "scopes/ (key, derive, resolve) · ADR 0009",
      },
      {
        title: "Time Scope and Plan",
        is: "A Time Scope is when something matters; a Plan is the slot you mean to do it in, inside that window. An empty Time Scope inherits the nearest window above, and a Task with no Plan inherits the nearest Plan above, clipped to its own window.",
        why: "\"Relevant this month\" and \"doing it Tuesday morning\" are different facts that change at different rates.",
        without: "Either everything is scheduled rigidly or nothing knows when it stops mattering.",
        lives: "tasks/scope_rules.rs · tasks/rules/plan_inheritance.rs · ADR 0001",
      },
      {
        title: "Timing",
        is: "Pending before the window, Active in it, Lapsed after. Worked out from the effective window, own or inherited.",
        why: "Start should only offer what is in scope now.",
        without: "Next month's work and last month's both crowd today.",
        lives: "tasks/rules/lifecycle.rs",
      },
      {
        title: "Due and Overdue",
        is: "A due is the window whose end makes work late: one set on the Task, or by default its window under Keep Overdue. Overdue is a flag: unfinished, not archived, past the due's end. It shows as an amber border.",
        why: "Being late is separate from being relevant; late work stays live.",
        without: "Lateness had to be a resolution, which settled and hid work that was still open.",
        lives: "tasks/rules/lifecycle.rs (effective_due, derive_overdue)",
      },
      {
        title: "Habit clocks",
        is: "A Window clock lays iterations side by side; a missed one is Archived, carried into the next (Overdue), or left Owed. An Interval clock keeps one open instance and counts the Gap from completion.",
        why: "Habits fail differently: a missed run is gone, a missed bill is still owed.",
        without: "One rule that is wrong for half the habits.",
        lives: "flows/rules/habits.rs · flow_recurrences.clock, miss_policy",
      },
      {
        title: "Cooldown and done times",
        is: "A cooldown blocks the next iteration for N units after one is done; under Owed it blocks every open one. Every finish records when it happened, and a Task's done date can be corrected.",
        why: "Done on Saturday should not count again on Sunday, and a habit ticked late should count from when it was really done.",
        without: "Back-to-back completions across a window edge, and clocks counting from the moment you remembered to tick.",
        lives: "flows/rules/cooldown.rs · tasks/done_date.rs",
      },
    ],
  },
  {
    id: "lifecycle", number: 4, name: "Lifecycle", band: "flow",
    title: "Status says where the work stands; archival says whether it is in play",
    intro: "Kept apart on purpose, so neither has to grow values that belong to the other.",
    cards: [
      {
        title: "Resolution",
        is: "How a passed window settled an item: Completed, or Missed under Archive. A Habit iteration resolves when every occurrence its template made is settled: done, compound ones by their derived status, a Commitment item's by a verdict, a wait item's by its release.",
        why: "A passed window needs an answer, and the Habit clocks count from it.",
        without: "Old work hangs on with no verdict, and clocks have nothing to count from.",
        lives: "tasks/rules/lifecycle.rs · flows/occurrences.rs (resolutions)",
      },
      {
        title: "Archival and Backlog",
        is: "Live, Backlog, Frozen or Archived. Set by hand (a Goal or Project's status, a Domain's archive; a Task's stored Archival, Live, Backlog or Archived; a Commitment's or wait's own archive), inherited (everything beneath a Task or Commitment archived by hand), or derived: a settled window archives, and so does a released wait whose window has passed. Delegation is not archival: it has its own pill.",
        why: "\"Set aside\" and \"finished\" are different questions; a backlogged Task keeps its real status. Putting a branch away is one write, and taking it back restores it exactly.",
        without: "Statuses multiply (\"done-ish\", \"paused-forever\"), every filter has to know them all, and archiving a project means archiving every step in it.",
        lives: "tasks/rules/lifecycle.rs · tasks/rules/archival.rs · filters/facts.rs",
      },
      {
        title: "Commitment verdicts",
        is: "A Commitment is judged, not done: Kept, Broken or still Unresolved. Its Verdict Window bounds how long the answer stays owed; past it, it Expires.",
        why: "A rule like \"phone off by 23:00\" is kept or broken, and an unanswered night may well have been kept.",
        without: "A missed check-in would count as a broken commitment.",
        lives: "tasks/commitments.rs · ADR 0005",
      },
    ],
  },
  {
    id: "inheritance", number: 5, name: "Inheritance", band: "growth",
    title: "Set it once on a branch",
    intro: "Worked out on read by climbing ancestors, never copied down.",
    cards: [
      {
        title: "Agentic",
        is: "A three-state flag (unset, yes, no) that inherits down and can be overridden. It decides the status model, and what the MCP may write. Each Agentic Task has its own brief, and needs a Spec before it can start.",
        why: "Mark a project for agents in one edit, and pull one Task back out of it.",
        without: "Flagging every Task by hand, and agents writing into your own work.",
        lives: "tasks/agentic.rs · src/utils/agentic.ts",
      },
      {
        title: "Scope containment",
        is: "A child's window sits inside its parent's, a Plan inside its window and inside the Plan it inherits, a due inside its window. Checked on every write; a write that leaves a Task with no Plan inside its window is refused, naming it; narrowing a parent offers to clamp its children (or, for Plans, clear theirs so they inherit).",
        why: "A step can't matter outside the window of the thing it is a step of.",
        without: "Children outliving their parents and plans scheduled after the work stopped mattering.",
        lives: "tasks/scope_rules.rs",
      },
      {
        title: "Link inheritance",
        is: "Time Scope, Plan and Agentic inherit today. Asynchronous deliberately does not. Tags, knowledge-base links and delegation are specified to inherit but not built.",
        why: "Context belongs on the branch; a filter on a parent's tag should find its children.",
        without: "Re-tagging every child, or filters that miss half a project.",
        lives: "docs/spec/link-inheritance.md",
      },
      {
        title: "Privacy",
        is: "A node's own Private flag hides it and everything beneath it, outside Private Mode and from the MCP even inside its roots.",
        why: "One switch keeps a whole area out of sight and out of agents' context.",
        without: "Hiding a subtree node by node, and leaking whatever was missed.",
        lives: "access/ · mindmap/rules/facts.rs",
      },
    ],
  },
  {
    id: "blocks", number: 6, name: "Blocks", band: "body",
    title: "Why something can't start yet",
    intro: "A block always carries its reason. Blocks gate starting work; they never change a status.",
    cards: [
      {
        title: "Block reasons",
        is: "An ordered list of reasons written on a Task or Goal by hand.",
        why: "Some obstacles are not on the board (\"waiting for the landlord\").",
        without: "Blocked work looks startable.",
        lives: "block_reasons/",
      },
      {
        title: "Dependencies",
        is: "A Task can depend on a Task, a Goal or a stored wait. Until it is met, the Task reads \"Blocked by task 6f3 (title)\". Cycles are refused.",
        why: "Order between pieces of work is a fact worth recording once.",
        without: "You remember the order yourself, and Start offers things out of turn.",
        lives: "tasks/mod.rs · mindmap/rules/facts.rs · src/utils/blocked-by.ts",
      },
      {
        title: "Derived blocks",
        is: "Blocks no one writes: an Agent at capacity, on the unfinished Agentic Tasks of its Claim, a Habit's cooldown, and a compound Task whose open sub-items are all blocked.",
        why: "One mechanism, so filters, badges and the MCP need nothing new for each.",
        without: "A special filter rule per feature, each one missing a view.",
        lives: "capacity/rules/blocks.rs · flows/rules/cooldown.rs · tasks/compound.rs",
      },
    ],
  },
  {
    id: "reading", number: 7, name: "Reading it out", band: "read",
    title: "One board, many readers",
    intro: "You and an agent must never disagree about what is live.",
    cards: [
      {
        title: "Presets",
        is: "All, Plan, Start, Do, Backlog and Unblock: each a rule over derived facts. Start, for example, drops blocked, pending, lapsed (but not Overdue) and planned-ahead work.",
        why: "\"What can I begin now?\" should have one answer, everywhere.",
        without: "Each view invents its own idea of \"now\".",
        lives: "filters/ (Rust) · src/utils/filter-tree.ts, list-filter.ts",
      },
      {
        title: "The conformance pair",
        is: "Every rule the views answer per keystroke or per press has one definition, in a Rust rules module. Most reach the frontend as a TypeScript copy, and one shared case file per rule family runs against both. The rules a press is predicted with (the status step, Alt+Enter, the Compound refusal, the verdict, the parenting table, the Plan View's triage and refusal) are not copied at all: the Rust rule is compiled to wasm and called, and the same case file runs through it.",
        why: "The views filter instantly on every keystroke, without a round trip; the corpus keeps the copies honest, and the wasm ones have no copy to keep.",
        without: "The agent's board and yours drift apart silently.",
        lives: "conformance/ · *-conformance.test.ts · crates/arlesh-rules(-wasm) · src/wasm/ · ADR 0010, ADR 0012",
      },
      {
        title: "Pills and the focus exemption",
        is: "Filters combine as Any, All and Not. The selected node stays on screen, dimmed, even after your own edit stops it matching.",
        why: "Completing a Task under Plan should not make it vanish from under the cursor.",
        without: "Every edit risks losing your place.",
        lives: "src/utils/filter-modes.ts, focus-exemption.ts",
      },
      {
        title: "Views",
        is: "Mindmap (the tree), List (rows), Plan (triage into scopes), Steps (one level at a time) and Zen (what's in progress). One tree and one filter model under all of them.",
        why: "Different jobs need different shapes of the same truth.",
        without: "Five boards to keep in step.",
        lives: "src/components/*View · docs/spec/*-view.md",
      },
      {
        title: "The MCP",
        is: "Agents' door to the board. They see only inside the roots you open, never what is private, and write only Agentic Tasks. They hand work back by asking a question.",
        why: "A clean, bounded context for an agent, on the same derived board you see.",
        without: "Agents read everything, or a separate copy that disagrees.",
        lives: "mcp/ · access/ · capacity/",
      },
      {
        title: "Agents and Claims",
        is: "An MCP session starts unattached and sees nothing. A one-time PIN, or the agent token it was given, makes it an Agent, bound for the connection. An Agent holds one Claim, a subtree inside your roots that is its whole view; only one active Claim covers a node, and a paused one frees the subtree. Agents declare an Account, usage is kept per account, and an Agent is at capacity while a window of its account is full before its reset. A subagent is a Child Agent of the session's Agent, told apart by the sub-token on its calls: its sub-Claim lies inside the parent's Claim and is no overlap with it, its standing and capacity follow the parent, and it goes when its parent goes or its Task is set Done.",
        why: "Several agents can work one board without overlapping, each in a bounded context, and one agent reaching its plan limit blocks only its own work.",
        without: "Every session sees the same roots, two agents write one subtree, and a limit hit by one blocks everyone or no one.",
        lives: "agents/ · mcp/agents.rs · mcp/mod.rs call_tool (sub_token) · migrations 0101, 0102, 0105, 0106 · plugins/arlesh-notify · ADR 0018, 0019",
      },
      {
        title: "The server",
        is: "`arlesh-server` serves the board over HTTP, as the first step toward multi-device. It runs the core through the Python bindings and adds no rules of its own. Every request carries a bearer token, which names the client the journal records. It serves the MCP at `/mcp` too, behind its own connect token, and holds the database while it runs, as the app does: it will not start while the app or another server holds it, unless forced.",
        why: "One copy of the board, reachable from more than one device, with one writer.",
        without: "The board lives only inside the running app on one machine.",
        lives: "crates/arlesh-py/python/arlesh/server · arlesh[server]",
      },
      {
        title: "Client mode",
        is: "Each device runs Standalone (its own database file, as before) or as a Client of arlesh-server. Every Tauri command goes through one Backend port: SqliteBackend in-process, or HttpBackend calling the server's routes, one per method. The server's change stream reloads every device's windows, undo is per device, and an unreachable server leaves the last board read-only.",
        why: "One board shared by several devices, with the app itself unchanged above the port.",
        without: "A second app for the server, or every component taught about HTTP; devices that each hold a different board.",
        lives: "crates/arlesh-backend/ (sqlite, http) · client_mode/ · conformance/client-mode.json · ADR 0011",
      },
      {
        title: "Pending writes",
        is: "An action the board shows before the server answers it: a status step, Alt+Enter, a verdict, a wait release, a rename, an editor's Save, or a new child or sibling. Its patch sets only the node's own fields, never a derived one. The window's pending writes go out one at a time, in order. A pending node pulses faintly until the answer. Each fresh board is drawn with the unanswered patches over it, and a refusal rolls back that patch and every later one on the node, with one toast. A new node gets a temporary id until its create is answered.",
        why: "In Client mode every write is a round trip and a reload, and a press that shows nothing for that long feels broken.",
        without: "Every press waits on the network, or the board computes derived values the server never agreed to.",
        lives: "src/utils/pending-writes.ts · apply-pending-writes.ts · src/stores/use-pending-writes-store.ts · ADR 0012",
      },
    ],
  },
  {
    id: "honest", number: 8, name: "Keeping it honest", band: "accent",
    title: "Trustworthy history and a truthful board",
    intro: "The board is only useful if what it says is true and every change can be taken back.",
    cards: [
      {
        title: "The undo journal",
        is: "SQL triggers on every table record each row's before and after. One gesture is one step; Ctrl+Z replays it in reverse, across windows. An agent's or another client's writes are journaled but never undone from the app.",
        why: "A trigger can't be forgotten by a command that doesn't know it exists.",
        without: "An inverse to write for every one of eighty-odd commands, and the next one missing it.",
        lives: "undo/ · scripts/generate-undo-triggers.sh · ADR 0006",
      },
      {
        title: "Clients and a second writer",
        is: "Every write is journaled with the client it came through: the app is `desktop`, and a Python session names itself. The app's Ctrl+Z takes only its own. While the app runs it holds the database, and another writer must force its way in; reading is never refused.",
        why: "More than one program writes the board now, and each must tell its own changes from another's.",
        without: "Ctrl+Z in the app would reverse what a script did, and a script could rewrite rows under the app's open windows unwarned.",
        lives: "database/ (client, hold, open) · migration 0092 · crates/arlesh-py",
      },
      {
        title: "Migrations",
        is: "Numbered schema steps, applied in order and never edited once applied. Data is moved aside, never dropped.",
        why: "Your real database must reach every new shape without losing anything.",
        without: "Upgrades that refuse to start, or quietly discard history.",
        lives: "crates/arlesh-core/migrations/",
      },
      {
        title: "A truthful board",
        is: "Nothing derived is stored, so nothing derived goes stale. A pending write shows only its own node's own fields, and only until a board that reflects it arrives. Every window hears about every change. An agent whose next step is yours must say so with a question.",
        why: "You act on what the board says; a board that lies costs more than none.",
        without: "Stale copies, windows that disagree, and work that looks held when it is waiting on you.",
        lives: "board.rs (board-changed) · AGENTS.md",
      },
    ],
  },
];

/** Every card by its title, for the graph's boxes to point at. */
export const MODEL_MAP_CARDS: ReadonlyMap<string, ModelMapCard> = new Map(
  MODEL_MAP_GROUPS.flatMap((group) => group.cards.map((card) => [card.title, card] as const)),
);
