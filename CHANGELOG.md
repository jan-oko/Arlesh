# Changelog

All notable changes to Arlesh are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Arlesh is a personal app in live preview with no release cycle, so new entries collect under
`[Unreleased]`; the numbered sections below are kept as history.

---

## [Unreleased]

### Added
- **Windows installers.** Every build of master, and every tagged release, now carries a Windows setup `.exe` (per-user, no admin prompt) and an `.msi`, beside the Linux AppImage and tarball. They are not signed yet, so the first run shows SmartScreen's warning: **More info**, then **Run anyway**. Data is kept in `%APPDATA%\com.atai.arlesh`.
  The tray works the same way as on Linux: a left click shows or hides the windows, a right click opens the menu, and closing the last window hides it there. On a light taskbar the tray icon is drawn black so it stays visible. A window restored at the next start comes back where it was left, and a window that was minimised when Arlesh was hidden or quit comes back at its real size and position.

- **Subtasks inherit their parent's Plan.** A Task with no Plan of its own now reads the nearest Plan above it, narrowed to its own Time Scope. That holds through Goals, Commitments and waits too. It shows as a fainter calendar badge, and the editor's Plan field shows it read-only, naming where it comes from, beside the control that sets a Plan of its own. Start, the planned / unplanned pill, the Plan View and the MCP all read it. The Plan View places a subtask in its parent's slot rather than among the unplanned candidates. Start now also hides a wait's check under a Task planned ahead.
  A Plan of its own must sit inside the one a Task inherits. A change that would put a Task outside it, or leave a Task whose window misses the Plan above it, is refused, and the refusal names the Tasks. Narrowing or moving a Task's Plan when subtasks below hold Plans of their own first asks whether to clamp their Plans into the new one, clear them so they inherit it, or cancel, and the whole change is one undo step. A Task that still ends up breaking the rule another way, such as through an undo, is flagged in red.

- **Archive a Task or Commitment by hand.** Right-click a Task or Commitment, on the Mindmap or in the List View, and pick **Archive** — or turn on **Archived** under the editor's Advanced section. It is put away with everything beneath it: the whole branch reads as archived, carries the archive badge and drops out of Plan and Start. **Unarchive** brings it back exactly as it was. Either is one `Ctrl+Z`. An agent can archive and unarchive its Agentic Tasks over the MCP too.

- **Commitments and waits in Flow templates.** A Flow or Habit template can now hold a Commitment item and a wait item beside its Task and Goal items: inside a template, `Shift+C` and `Shift+E` create them inline, where they used to be refused. They sit wherever a Commitment or a wait could sit outside a template.
  Each iteration of a Habit gets its own Commitment, judged on its own, with the Verdict Window set on the item, and its own wait, released on its own and checked every so often from a first check you place inside the window ("the third day"). An iteration stays open until its Commitments have a verdict and its waits are released, and a Task item can wait on a wait item. Starting a plain Flow makes them real Commitments and waits; copying a Flow copies them; and converting a subtree into a Flow now keeps its Commitments and waits as items instead of deleting them.

- **A Delegated pill in the Filter menu.** Delegated Tasks have a pill of their own beside Archived and Backlog (key `g` in the menu). Left off, Plan and Start hide delegated Tasks as they did before; **Include** shows them there; **Exclude** hides them everywhere, Do included. The node searches follow it, offering delegated Tasks only while it is on Include.

- **Arlesh over HTTP.** `pip install 'arlesh[server]'` adds `arlesh-server`, which serves your
  board over HTTP from the machine that holds it: the whole board in one request, every kind of
  node's edits, Arlesh's scope and lifecycle rules, and the MCP endpoint at `/mcp`. Every request
  needs a token you issue per device with `arlesh-server token add <name>`. That name is recorded
  on every change the device makes, and a token can be revoked at any time. It listens on this
  machine only unless you pass `--host`, and serves HTTPS when given `--tls-cert` and `--tls-key`.
  While it runs it holds the database, as the app does, so only one writer works on it at a
  time: it will not start while the Arlesh app or another server has the same database, unless
  you pass `--force`.

- **Python bindings.** A Python package, `arlesh`, can open your Arlesh database and run the app's own
  logic on it: read the whole board with everything Arlesh derives, create, edit, move and delete
  every kind of node, and call the rules directly (scope windows, lifecycles, Habit iterations). It
  opens read-only unless you give it a client name. A Python session writing while the app is open is
  refused unless it forces its way in, and the app's Ctrl+Z only ever undoes what you did in the app,
  never a script's changes.

- **An agent can filter the board by the List View's pills.** The MCP snapshot's `filter` now takes the List View's kind selector and its pills — Under, Depends on, Task, Goal and Project status, Verdict, Scope, Blocked, Agentic, Asynchronous and Private — and answers them by the same rules the List View uses, so an agent asking for "the blocked Tasks under this Project" sees the rows you would see.

- **A Task's short id in its editor.** The Task editor's Advanced section now shows the Task's short id — the one an agent names it by and a "Blocked by" reason shows — with a Copy button beside it, so you can name a Task to an agent by the id you see. Habit occurrences and a wait's check tasks show theirs too.

- **Compound and the wait template on Habit and Flow templates.** The flow item editor now has the Task editor's **Compound** switch and, under its **Asynchronous** switch, the same wait-template fields: title, tags, Time Scope and Check every. The Flow editor offers both for the root of a task-instance flow. Every Task the template spawns takes them: starting a Flow copies them onto the Tasks it makes, and each Habit occurrence, an iteration's root included, reads them from its template.
  An occurrence can say otherwise in its own editor, or with `V`. It can switch Compound on or off for itself alone, or have a wait of its own, or none by emptying the section. A compound occurrence's status follows its sub-items as a compound Task's does, and it is blocked when all of its open sub-items are. Its iteration waits on it: steps you add to it by hand, and waits under its steps, keep the iteration open until they are done. A cooldown or an Interval's next window counts from when its last step was finished.

- **Habit cooldown.** A Window Habit can now rest between completions: set a **Cooldown** in the Habit editor (after the Gap) — days for a weekly Habit, weeks or days for a monthly one, parts of the day for a daily one. After an iteration is done, the next one is **blocked** — "Cooling down until Mon 5 Oct, 02:00" — until the cooldown has passed, and the block lifts by itself: a weekly Habit done on Saturday with a one-day cooldown is blocked through Sunday. Catching up last week late blocks this week the same way, and on an Owed Habit a completion blocks every week still open. Only completing starts a cooldown — setting work aside does not. A cooldown as long as the Habit's window is refused, and Interval and commitment Habits take none.
  **Done date.** A Done Task's editor now shows when it was done, under Advanced, and lets you set it back — so something ticked late counts from when it was really done, for a Habit's cooldown and an Interval Habit's next window alike. A date in the future is refused, and saving a done Habit occurrence again no longer moves its done time to the moment of saving.
  **Completion times.** Achieving a Goal, releasing a wait and giving a Commitment its verdict now record when it happened, the way finishing a Task always has.
  **Commitment Habits** can now run on an **Interval**: give a verdict, Kept or Broken, and the next one comes after the Gap; an unanswered one waits for you rather than expiring. A commitment Habit on Window + Owed takes a **cooldown** too, which blocks its unanswered nights until it passes — you can still record a verdict on a blocked one.

- **On Agent and Review: Agentic tasks get statuses of their own.** A task that reads as Agentic now has its own set of statuses: **To Do**, **On Agent** (an agent holds it), **Review** (its agent has asked you something and is waiting), **Doing** (you are on it) and **Done**. There is no Started on an Agentic task. Ordinary tasks are unchanged.
  On Agent is hidden from Start, Do and the Zen View, so an agent's work no longer reads as yours. To see it, turn on the new **On Agent** pill in the Filter menu (or press `o` there); the Filter button wears its dot while it is on.
  A task reads **Review** while its agent has an open question under it, and goes back to On Agent once the question is answered. Review shows in Start, Do and the Zen View whatever the "shows Started tasks" settings say, comes first (a **Review** section at the top of the List View, Review cards first in the Zen grid), and draws with Started's glyph, the ring with a hollow centre. On Agent's glyph is a small bot head.
  Changing whether a task reads as Agentic, by its flag or by moving it, converts its status and every inheriting task's beneath it (In Progress ↔ Doing). A task with no counterpart, Started or On Agent, stops the change, and a message names it so you can settle it first.

- **Answer an agent's question where you see it.** A Review card in the Zen View, and the agentic part of the Task editor, show the agent's question with an answer field. **Send**, or `Ctrl+Enter` in the field, stores your answer and closes the question, and the task goes back to its agent.

- **Delegation you can see, and agents can set.** A delegated Task now wears a paper-plane badge in its status row in every view that draws one (Mindmap, List, Steps, Plan and Zen). Hovering says "Delegated to <name>". The wait a delegated Task carries now names who is to finish it, for example "Tuli finish: Book the venue". A wait you gave a title of your own keeps that title. Agents can delegate to a person through the MCP: `arlesh_tasks.create` and `update` take `delegate`, set to `{"kind": "person", "id": N}`, or `null` on update to take the delegation back.

- **Interval Habits.** A Habit on an **Interval** clock has one open occurrence at a time: complete it, and the next one's window starts the unit after the one you completed it in, plus the Gap — "every three weeks from the last haircut" rather than every third week on the calendar. An open occurrence left past its window stays, flagged Overdue.
  An Interval Habit can be **Unscoped**: its occurrences have no window and are never Overdue, and the next one appears the Gap after the day you completed the last — with no Gap, the moment you do.

- **Overdue work shows under Start.** Start used to drop anything whose window had passed, so late work vanished from the one view that asks what to begin now. An Overdue Task, Goal or wait now stays under Start; blocked, backlogged and delegated items, work rescheduled into a Plan still ahead, and Missed items still drop out.

  Under Start the List View gathers Overdue work into an **Overdue** section at the top, above the Asynchronous section, with its subtasks brought along. Switch it with **Overdue first under Start** under Settings → List (on by default). **Show the overdue border on rows**, on the same page, turns the amber border off in the List View, as Zen's switch does for its cards.

  Under Start, a blocked task no longer hides a subtask it depends on: that subtask, and everything under it, shows, with the blocked task above it. The rest of the blocked task's subtree stays hidden, as before.

- **Agent capacity lock.** Agents can now say they are at capacity. While they are, every Agentic task that isn't done is blocked with the reason "Agents at capacity", and it behaves like any other block: Start hides it, it can't be started, it shows the blocked sign, and Unblock lists it. Tasks already In Progress or Started keep their status. Agentic waits are not affected.

  An agent sets and clears the lock over the MCP (`arlesh_capacity`), and the agents' own reading of the board shows the same block. You can set and clear it under Settings → Agents. Every open window updates as soon as the lock changes.

  A small bot head now appears in the top bar whenever agents need watching: while the lock is on (amber padlock), while an agent has a question waiting for you (red !) or is waiting on something else such as CI (blue hourglass), or while Agentic work is In Progress. Its tooltip gives the counts. Clicking it opens a short menu that clears the lock or shows the waits and the work in the List View. To hide the head entirely, turn off **Show agent status in the top bar** under Settings → Agents.

- **Compound tasks: a status made of their sub-items.** Press `V` on a Task (Mindmap, List View, Steps View, Zen View), or turn on *Compound* in its editor, and its status follows everything beneath it: Done when every sub-item is Done, In Progress when any is, Started when any has begun or finished, To Do otherwise. Sub-tasks, goals (Done once achieved), waits and commitments (Started while pending or unresolved) all count, however deep; archived items don't. When every sub-item still open is blocked, the compound is blocked too, with the reason "All open sub-items are blocked". Its status glyph gets a dashed outer ring, and setting its status by hand is refused with a note saying why. Turning it off keeps the status it was showing, in one undoable step. Agents can switch it too (`compound` on `arlesh_tasks.update`). A new setting, *Show compound tasks on the grid* under Settings → Zen (on by default), takes compound tasks' cards off the Zen grid while their sub-items stay.

- **A tabbed keyboard cheat-sheet you can search.** The cheat-sheet (`Ctrl+Shift+/`) now shows one tab per area — Global, Filters, Tabs, each view and the Scope pickers — and opens on the view you are in, marked *here*. The sheet now fills most of the window at one size on every tab, and only its list scrolls (`PgUp` / `PgDn` page it, even while you type). A tab's shortcuts sit in two columns, and the long ones (Global, Mindmap, List View, Steps View) are split under headings such as Create and Edit. Switch tabs with a click or with `←` / `→`.
  A search field is focused when the sheet opens: type part of a description (`flow`) or a key (`shift+t`) and the matching shortcuts from every tab are listed under their headings, with a message when nothing matches. `Esc` clears the search and returns to the tab you were on; a second `Esc` closes the sheet.
  The flag keys now read **Toggle Agentic**, **Toggle Asynchronous** and **Toggle Backlog** on the sheet.

- **A dot on the Filter button for filters you can't see.** When the Filter menu holds a setting that nothing outside it shows, the Filter button wears a small dot: the Zen View's Agentic pill (which draws no chip), or the Archived or Backlog pill set to include or exclude, in any view that offers it. Tags and the List View's pills already show as chips, and the row-kind and strip toggles, Private Mode and the Mindmap's Info / Flow toggles never light it.

  **Esc** now closes the Filter menu in every view, and focus goes back to where it was; the view underneath never sees the key, so the Mindmap's selection stays. In a search box with text in it, the first Esc clears the text and the second closes the menu.

- **The amber Overdue border in every view.** List View rows and Steps, Plan and Zen View cards now draw the amber border an Overdue node has on the Mindmap. A selected item that is Overdue, in any view, draws its selection in a colour of its own, so you can see both at once. In the Zen View it can be turned off: Settings → Zen → *Show the overdue border on cards*. Screen readers hear "Overdue" on every Overdue item.

- **A Due for every Task, and Overdue measured against it.** A Task can now carry a **Due** — the scope by which it should be finished — set in the Task editor beside the Keep Overdue / Archive pills, and held inside the Task's Time Scope. Past the end of its Due, a Task that is not done (and not archived) is **Overdue**: it gets an amber border — on the Mindmap and on List View rows and Steps, Plan and Zen View cards — may be planned outside its Time Scope, and matches the List View's Overdue filter. That now includes a Task past a Due inside a window that is still open, and a delegated Task.

  Without a Due of its own, a Task keeps behaving as it did: under Keep Overdue its Time Scope is its Due, so it turns Overdue once the window passes; under Archive it has none. Sub-tasks take theirs from the window they inherit. A Task in the Backlog is never Overdue unless you gave it a Due. A Task with no Time Scope anywhere above it can have a Due too — the field then has its own row, below the Plan. Agents can read and set `due_scope` through the MCP.

- **Started: a status for work you have begun and put down.** A Task (or Habit occurrence) can now be **Started** as well as To Do, In Progress or Done. `Alt+Enter` sets a To Do or Done task Started, and flips an In Progress one to Started and back — pause and resume — in the Mindmap, List, Steps and Zen views; plain `Enter` on a Started task resumes it. Its icon is In Progress's with the inner circle left open. Like In Progress, it is refused while the task is blocked, takes a task out of the Backlog (with a toast), needs a Spec on an Agentic task, and is offered in the Task editor.
  Plan shows Started tasks, and so does Start by default; Do and the Zen View leave them out by default. Three settings switch them: *Start shows Started tasks* and *Do shows Started tasks* under Settings → General, and *Show Started tasks on the grid* under Settings → Zen. On the Zen grid, a card that is not In Progress — a Started one, or one you just marked Done or To Do and still have selected — shows its status icon at the head of its badge row. Agents can set `started` through the MCP `set_status`.

- **Zen View: only what you are doing now.** A fifth view, beside Mindmap, List, Plan and Steps — pick it from the top bar's view selector or press `Ctrl+J`. It shows the Tasks in progress (the Do preset, always, whatever the tab's own preset is) as a grid of cards that fills the window: one to three tasks make big cards with big titles, many make smaller ones, and once the cards reach a single line of text the grid scrolls instead of shrinking further. Each card centres its title, the path to it and the usual badges, all scaled together with the card (Settings → Zen → *Show badges on cards* turns the badges off).

  Above the grid sit two strips: the Commitments you have not judged yet, and the Expectations that are open now. Turn either off in the Filter menu — the same switches and keys as the List View's row kinds (`c` / `e` while the menu is open, Shift for one alone) — per tab. The Filter menu also has the List View's **Agentic** pill, to show only agentic work or only the rest. The List View's keys work here — `Enter`, `E`, `R`, `P`, `D`, `B`, `A`, `W`, `X`, `Delete`, `Ctrl+Home`/`Ctrl+End` and the rest — except the ones that create something. The arrow keys move across and down the grid, and up into the strips.

- **`D` adds a dependency without opening the editor.** With a Task selected on the Mindmap, in the List View or in the Steps View, `D` opens a small search bar right at the selected node, row or card. Type to find the Task, Goal or Expectation it should wait on, move with the arrow keys, and press Enter (or click) to add it; Esc closes without a change. The search leaves out the Task itself, what it already depends on, and anything that would make a circle of dependencies, and one `Ctrl+Z` takes the new dependency back.

  Only a Task can depend on something, so `D` on anything else says so in a toast, and so does `D` on a Mindmap multi-selection — pick one Task.

- **Ctrl+Home and Ctrl+End in the List View.** `Ctrl+Home` selects the first row and scrolls the list to the top; `Ctrl+End` selects the last row and scrolls to the bottom. Path headers are skipped, as the arrow keys skip them, and an empty list is left alone.

- **Scope pickers work from the keyboard.** In any scope picker — the `P` quick picker, and the Time Scope and Plan fields in the editors — the arrow keys move a highlight over the scopes shown, Space picks the highlighted one (a second pick makes a range), Enter steps into it (a month into its weeks), `[` and `]` show the previous and next period, `\` goes up a level, and Ctrl+Enter applies. The keys are listed in the cheat-sheet under *Scope pickers*.

- **`P` sets a Task's Plan without opening the editor.** With a Task selected on the Mindmap, in the List View or in the Steps View, `P` opens the editor's own Scope Picker right at the selected node, row or card. Pick a scope and press Ctrl+Enter or Apply to plan it, Clear to unplan it, or Esc to close without a change. Every Plan rule still holds — it stays inside the Task's Time Scope (Overdue Tasks excepted) and its parent's Plan, a backlogged Task comes out of the Backlog with a toast, and a refusal says why — and one `Ctrl+Z` takes it back.

  On the Mindmap a multi-selection is planned in one go, as a single undo step; anything selected that isn't a Task is left alone and counted in a toast, and a node that can't hold a Plan is refused by name. The Plan View keeps its own `P`, which fills parts of the day.

- **Private nodes wear a crossed-out eye.** A node you mark Private now shows a small crossed-out-eye badge in its status row, with the tooltip "Private", on the Mindmap, List View rows, and Steps and Plan View cards — Habit occurrences and derived waits included. Only the node that carries the flag is badged: what sits under it is hidden with it outside Private Mode, but carries no badge of its own.

  A Steps View card no longer spells out a separate "Private" field — the badge says it.

- **Turning pages in the Steps View with `[` and `]`, and with the arrows.** `[` and `]` turn to the previous and next page of a Step, alongside `PageUp` and `PageDown`. And the arrows no longer stop dead at a page's edge: `→` on the last card of a page moves on to the first card of the next page, and `←` on the first card goes back to the last card of the page before.

- **The Steps View folds passed Habit history, and you can walk down into it.** A run of passed iterations of one Habit that reaches your "Collapse habit history after N" threshold is now one card, titled like the Mindmap's folded node — "Journal: 14 passed · 9 done, 5 missed" — with its day span in a tooltip. Press `Enter` on it to step inside: the run opens onto its years, seasons, months or weeks (only the levels it actually spans), each a card of its own with its own tally, down to the iterations themselves. Every level is a segment in the breadcrumb, `Shift+Escape` climbs back through them, and a tab left standing inside a run comes back there after a restart. The card is a drawing rather than something stored, so `E`, creating inside it, deleting and marking it are refused with a message saying so.

- **Add filters from the keyboard with `Ctrl+F`.** Type a tag, a status, a Verdict or Scope value, Blocked / Agentic / Asynchronous (and Private while Private Mode is on), Archived or Backlog — or, in the List View, any node's name to filter by **Under** or **Depends on** it, or Tasks / Commitments / Expectations to show or hide that kind of row — and pick from the matches. Enter adds as All, Shift+Enter as Any, Alt+Enter as Not, and the box clears and stays open so you can add several in a row. The filters you already have are listed first, so you can change one with Enter or remove it with Delete. Esc closes it.

- **Choose which kinds of row the List View shows.** The top of the filter popover now has Tasks, Commitments and Expectations toggles, all on by default, so you can hide a kind of row without touching the rest of your filter. At least one stays on. The toggles step aside while the Expectations option (`Alt+E`) is chosen, Reset turns all three back on, and each tab remembers its own choice. `Alt+Shift+T`, `Alt+Shift+C` and `Alt+Shift+E` flip them from the keyboard.

- **Downloadable Linux builds.** Every commit to master publishes an AppImage and a tarball of the bare binary to the rolling *latest* pre-release on GitHub, and each `vX.Y.Z` tag gets a release of its own. They are built against an older glibc, so they run on current distributions including Arch, and they share their data directory with a locally built Arlesh.

- **A scope for the Plan preset.** While Plan is the preset, the top bar offers a *Plan scope* beside it: pick any scope in the calendar and the Mindmap, List and Steps Views show only the Tasks relevant to it — by default, those whose Time Scope (their own, or the nearest scoped parent's) lies within it. Tasks with no Time Scope are hidden, and a wider parent stays on screen above a sub-step that fits. Each tab keeps its own scope; *Clear* removes it.
  A new switch under Settings → General, *Plan scope keeps Tasks that overlap it*, widens the match to any Task whose Time Scope overlaps the scope, Tasks with no Time Scope included. An agent reading the board over MCP can ask the same question with `plan_scope` and `scope_match`.

- **Agents manage a whole Agentic Task over MCP.** `arlesh_tasks.create` and `update` now also set a Task's Time Scope and Plan, what it does when its scope passes, whether it is Asynchronous, its block reasons, its tags and its prerequisites — so an agent can record "this comes after that" in Arlesh instead of `bd`. The app's own rules apply: a Plan must fit its Time Scope, a dependency cannot close a cycle, and a prerequisite or tag must be one the agent can see. An update lands whole or not at all, and none of it enters your Undo Stack.

- **Choose the MCP port in Settings, and see whether the endpoint is running.** The Settings MCP
  page now has a port field (4747 by default). Changing it moves the endpoint straight away — no
  restart of Arlesh needed. The page also says whether the endpoint is listening and on which
  address, or why it is not — typically that another Arlesh already holds the port — with a
  Restart button to try again. `ARLESH_MCP_PORT` still overrides the setting when it is set, and
  the page says when it does.

- **Agents can leave a note under their Tasks over MCP.** An agent can now hang an Info — a
  one-line text with optional longer details — under a Task that reads as Agentic inside the parts
  of the board you have opened to the MCP. When it shortens a long Task title, it can keep the full
  wording there. Like the agent's other writes, the note never ends up on your Undo stack.

- **Agents can create and work their own Tasks over MCP.** Inside the parts of the board you have
  opened to the MCP, an agent can now create Tasks — always Agentic — anywhere except under a Task
  you marked Not agentic, and can retitle, brief, start, finish and move Tasks that read as
  Agentic, including Habit occurrences, whose edits land on that one occurrence — and archive a
  Habit occurrence. A status change
  names the status the agent last saw, so two agents cannot both claim the same Task. Nothing is
  ever deleted, and an agent's writes never end up on your Undo stack.
  Agents can name any node by a short id — the first few characters of its id — shown beside every
  node the MCP reads; one that has become ambiguous is refused with the candidates listed.
  An agent can also ask for just the Tasks that read as Agentic — optionally only the most urgent
  ones — each with its brief, most urgent first.
  The MCP server is now called `Arlesh` (connect with
  `claude mcp add --transport http Arlesh http://127.0.0.1:4747/mcp`); its tools keep their names.

- **A cycle can be planned into itself.** Each cycle in a flow item's Cycles list has a **Planned** toggle beside it. On, the cycle is planned into its own window — a Noon cycle into Noon, a Day 3 cycle into Day 3, a whole-scope cycle into the whole flow window — and every occurrence it draws counts as planned in the Plan View and the filters. Off, the default, leaves it unplanned. This is what lets a part-of-the-day cycle, which has nothing finer to plan within, be planned at all.

  A task Habit's root can be planned the same way: its Plan dropdown offers the window's own kind as "(instance scope)", which plans each iteration's root into that iteration's whole window.

- **A Habit occurrence can start a wait.** Switch an occurrence to Asynchronous and give it an Expectation, exactly as on any Task: once it is done, the wait appears beneath it with its checks, and you can release it or archive it. `Shift+W` works on occurrences too. An occurrence can also have its issue link cleared on its own.

- **A Habit's steps carry the fields of their kind.** The flow item editor now sets a step's tags, block reasons and — for a task — Backlog, Asynchronous and Agentic. Every occurrence reads them unless you changed that occurrence yourself.

  Saving a step's cycle pairs keeps what its occurrences recorded. A change that would drop something recorded asks first: **Archive & new** or **Discard & regenerate**.

- **Agentic tasks carry a brief.** In the Task editor's and the flow item editor's Advanced
  section, while a task is agentic the Agentic control is followed by a **Brief**, collapsed until
  you open it: a priority (MW, A, B or C, most urgent first), the Spec, the Design, the Acceptance criteria and Notes — what
  an agent reads about the work. Advanced opens by itself while the task is marked Agentic or its
  brief is written. The
  brief belongs to the task and is not inherited, even though the Agentic flag is. An agentic task
  cannot be started without a Spec: moving it to In Progress is refused with a message saying so,
  from the status control, `Enter`, the editor and every view.
- **An agent can wait on you.** An agent working an agentic task through the MCP can raise a wait
  under it with its question in a note — "the agent is waiting on you". It shows among your waits
  with the bot-head badge in the accent colour, the question as its tooltip, and in the
  Expectations list. Answer it in the wait's editor, in its own Answer field: a question can't be
  released without an answer, from anywhere. An agent can also wait on something other than you,
  such as CI; that wait wears a quieter badge and the agent releases it itself when it is done.
  Only a wait directly under an agentic task can be one.

- **Settings modal.** The gear in the top bar now opens a settings modal organised into pages —
  General, Mindmap, List, Steps, Plan, Windows & tray, Expectations and MCP access — in place of the
  small popover whose switches came and went with the active view. Every setting is reachable from
  any view, and each keeps the value it had. Move between pages with ↑/↓, and close with Escape or
  the ×.

- **MCP access.** The MCP endpoint now sees only the parts of the board you open to it. On the
  settings modal's *MCP access* page, add **MCP roots** with the node search: an agent can read
  everything inside a root and nothing outside, Agentic tasks inside a root are the only thing it
  can write, and private nodes stay hidden even inside one. With no roots it sees nothing — so
  after updating, add a root before an agent can read the board again. Every node the MCP can see
  shows an antenna in its status badges, naming the root it is seen through. The agent is told its
  roots when it connects, and a request for anything outside them is refused as `not_permitted`.
  Adding or removing a root is undoable.

- **Expectations: waits your tasks depend on.** A new kind of node for something outside your own action that you are waiting on — a training run finishing, someone replying. Create one with `Shift+E` anywhere a Task can live; it holds notes, carries a Time Scope and tags like a task, is Pending until you release it (`Enter` or a click on its icon — a still spinner of short ticks that gains a check once released), and can be archived. A task that depends on a pending Expectation reads as blocked until it is released, and the Task editor's dependency picker offers Expectations beside Tasks and Goals.
  Say how often to look in on one with **Check every** — every N days, weeks, months or seasons, starting today or on a day you pick. Check every can also count hours or minutes. A "check on it" task appears beneath the wait once a check is due, never before the starting day; completing it (`Enter`, or its status control) marks it done — it stays, like any done task — and the next one falls due one interval later. Pressing it again reopens the latest check. Clear the setting to stop checking, or release the wait. The check task's title prefix ("Check: " by default) can be changed in the settings. The List View has an **Expectations** option (`Alt+E`) showing every pending wait, and Plan and Start show them by their own rules. A delegated task now waits on a derived Expectation of its own, released when the task is done.

- **Switch what the Plan View is filling with one letter.** With nothing selected, `S`, `M`, `W`, `D` and `P` fill seasons, months, weeks, days and parts of the day. Going coarser lands on the scope holding where you are — `M` from a week goes to that week's month (the month its first day is in). Going finer lands on today if today is inside, and otherwise on the first one. The kind dropdown now lands the same way. With rows selected the letters keep planning into a subscope as before, and no letter fires while you are typing or while the dropdown or date picker is open.

- **Go up to the parent scope from the Plan View.** An **↑** button beside the step back fills the scope one rung up instead: a part of the day goes to its day, a day to its week, a week to its month, a month to its season, and the kind selector follows. A week that crosses into the next month goes to the month its first day is in. `\` does the same from the keyboard. A season is the top, so there the button is greyed out and says why on hover, and `\` says so in a toast rather than doing nothing.

- **Select several rows in the Plan View and plan them in one go.** `Shift+↑`/`Shift+↓` and `Shift+click` extend a run from wherever the cursor was, and `Ctrl+click` adds or removes one row. `Enter`, a number, a letter or a drag then acts on the whole selection, and the lot is a single `Ctrl+Z`.

  A batch that plans five of six is not taken back because the sixth was refused: those five happened and you can see them. Whatever did not land is counted in the toast instead — which bound refused it, what came out of the Backlog on the way in, and a straddling bucket that carried its rows outside the scope you are filling.

- **Plan into a week, a day or a part of a day without leaving the scope you are filling.** With *Split by subscope* on, a card reaches one of the buckets three ways: drag it onto the bucket, press the bucket's **number** — `1` through `7`, counting down the pane in calendar order — or press its **initial** where one letter names it and nothing else. Monday and Wednesday answer to `M` and `W`; Tuesday and Thursday both start with T and so take their numbers, as do Saturday and Sunday. Premorning, Morning and Afternoon answer to their letters; Noon and Night collide on N. Week numbers never get a letter, because every week of a month starts with the same one. Whatever keys a bucket answers to are printed on its heading.

  The other half of that is what the split no longer does: there is no longer a "plan into this scope" while its parts are what you are filling, and no catch-all section collecting the work that fell between the buckets. Work pinned to the scope itself, or spread across several of its parts, now appears on the **candidates** side — where it still needs placing, and where the gestures that place it are.

- **A tab can be torn into its own window.** Drag a tab out of the strip and it becomes a second
  window — a full window, with its own tab strip, its own tabs and its own filters — so two parts
  of the board can be on screen at once, one per monitor. The tab menu offers the same thing as
  **Move tab to new window**, and offers **Move tab to "…"** for every other open window, which is
  how a tab comes back. Closing a window's last tab closes that window; closing a window that is
  not the last one simply closes it, and only the final close is governed by *Close to tray*.

  Dragging works both ways: drop a tab anywhere on another window and it moves there, drop it
  anywhere that is not an Arlesh window and it becomes a window of its own. Dragging works on
  Wayland, where apps are not told where the pointer or their windows are.

  Every window is numbered in its title — `Arlesh 1`, `Arlesh 2 — Bugfixes` — and the tray's menu lists them by the same title, each with a check
  while it is on screen: click one to hide or show that window alone, where clicking the tray icon
  still hides or shows them all. A window keeps its number while it is open and gets it back when
  Arlesh reopens; a new window takes the lowest number not in use.

  From the keyboard: **Ctrl+N** opens a new window, beside Ctrl+T's new tab, starting at the
  subtree you are looking at. **Ctrl+Alt+N** takes the current tab into a new window — the same
  thing, but with what you are holding. Both are on the cheat-sheet.

  Your windows come back when you reopen Arlesh, at the size, the position and with the tabs you
  left them with. A window whose monitor is no longer connected reopens somewhere you can reach it
  rather than off screen.

- **An edit in one window appears in the others.** Create, edit or delete anything and every other
  open window catches up by itself — no refresh, no switching back and forth to make a change show.
  A node you delete in one window stops being there in the other, so you can never act on something
  that is already gone. An issue link set by an agent over the MCP endpoint now shows up the same
  way, where before it needed a restart to appear.

- **Steps View: one level at a time, as cards you enter.** A fourth view, on `Ctrl+S`. The node
  you are standing on is drawn as a header card and its direct children as cards beneath it, and
  nothing deeper — so a wide branch stops being a wall and picking the next thing stops meaning
  reading the whole subtree.

  Entering a card makes it the Step and redraws. It moves the same place the breadcrumb and `Ctrl+O`
  move, so switching to the Mindmap afterwards lands you where you walked to, the breadcrumb names
  the Step as it does everywhere else, and `Shift+Escape` and `Ctrl+Escape` climb back out — there
  is no new navigation vocabulary to learn. Each tab remembers it is showing Steps, so one tab can
  be a walk while another stays a Mindmap.

  A card carries what the editor carries: the fields you would open the editor to read, chosen by
  kind, and never a second copy of what its icon or its badges already say. Under them sit the
  node's first Info notes as bullets, as many as the card has room for, with the last line saying
  how many did not fit rather than dropping them in silence. A card that holds something says how
  much — "3 of 12", what the current filter will show against what the board actually holds. All four arrows move between cards, `Enter` descends, `E` opens the editor, `Space` cycles
  a status, and a leaf opens on an empty Step that offers to create the first child rather than
  being a dead end.

  Every card is coloured by the aspect it lives under, as a List View row is, so a Step reads at a
  glance as one place on the board. It is a light wash of the aspect's hue rather than the colour itself, so text stays
  legible on every aspect in both themes, the pale ones and an Aspect's own card included. What
  state a card is in is left to its icon and its badges.

  Cards are created and deleted with the Mindmap's keys and rules: `Shift+Enter` puts a new card
  beside the selected one, `Ctrl+Enter` a new parent around it, and `Tab` (or `Shift` and a kind's
  initial) makes a child of the selected card and steps into it to show it. With nothing selected,
  `Shift` and a kind's initial puts that kind on the Step you are looking at, and so does the "+"
  beside the Step's header card, which lists the kinds the Step can hold. A new card is selected
  with its title open for naming. `Delete` asks first, then lands on the next card. The Step you
  are standing on cannot be deleted or given a sibling from inside it, and says so. `Ctrl+Z` takes
  back either in one press.

  A wide Step turns to pages rather than scrolling, with `PageUp` and `PageDown` for the landings,
  and a card-size setting per tab in the gear menu.

- **Delegate a task to the agent.** An agentic Task now has a **Delegate to agent** button beside its Agentic flag in the Task editor's Advanced section. One click hands the Task to the agent and a second takes it back. A task can now be delegated to the agent itself instead of to a person made up to stand in for it.

- **The Plan View can group by path, and split what is planned into its subscopes.** Two new switches in the settings gear, both off until you turn them on, both shown only while the Plan View is up.

  **Group by path** gives both panes the same headers the List View has: one line naming the chain — `Growth › CODE › ARLESH › Features` — above each run of work that lives in the same place, instead of nothing at all. The segments behave as they do in the List: click one to enter it, Ctrl-click to file it as an Antecedent pill.

  **Split planned by subscope** turns the right-hand pane into one section per bucket — the weeks of a month, the days of a week, the parts of a day — so filling a month shows you every week and what is in it at once, rather than one scope at a time. Every bucket is always open; there is nothing to unfold. Weeks that poke outside the month are shown and labelled *partial* with their dates rather than quietly left out, empty buckets are drawn because an empty week is worth seeing when you are deciding what to put in it, and anything planned to the month itself — or across several of its weeks — is collected under its own heading at the top instead of disappearing. The left-hand pane is not split: work that is not planned yet is not in any bucket.

  The keyboard is unchanged: `Down` walks from the last card of one bucket straight into the next, and headings are never landed on.

- **A third view — Plan — fills one scope at a time, as a two-pane triage.** Filling a week used to mean re-filtering the List View, opening a task, setting its Plan, closing it and doing it again, with nothing on screen saying what the week already held. The Plan View puts both halves of that question side by side: on the left, the **candidates** — work that is relevant now and unscheduled — and on the right, **what the scope already holds**. Moving a card across sets its Plan; moving one back clears it. That is the only thing this view writes, and a move is undone by `Ctrl+Z` like any other change.

  **A candidate is unplanned work whose window reaches into the scope** — its own Time Scope, or the one it inherits — and unscoped work, which is always relevant, is always offered. The right-hand pane counts anything planned *inside* the scope, so a week being filled shows the task you pinned to Tuesday rather than pretending the week is emptier than it is. Work planned somewhere else appears in neither pane: it is neither unscheduled nor here.

  **Backlogged work is off the table by default, and one switch away from being on it.** Backlog means deliberately not now — and a planning pass is also when you reconsider that. Planning something out of the Backlog takes it out of the Backlog, and the view says so rather than letting a badge quietly stop being drawn.

  **A move that would break a containment rule is refused, and the toast says which rule.** A task cannot be planned outside its own Time Scope, or outside its parent task's Plan, and nothing is widened on your behalf — a window says when work *matters*, and changing one is a decision for the editor. The selection stays on the task the message is about; a move that went through advances to the next card, so a pass is `Enter` down the candidates.

  **`Ctrl+P` opens it from anywhere**, and **any scope kind can be filled** — season, month, week, day or part of day — with `[` and `]` stepping to the one before or after, and the scope's own name opening the calendar to jump anywhere. A pass opens on the *current* scope of the kind you last filled: the kind is remembered with the tab, the week is not, because last Friday's week is not the one you want on Monday. The view shares the tab's subtree and filters with the other two, so entering a branch anywhere narrows all three.

- **Closing the window no longer quits Arlesh — it hides it to the system tray, and everything keeps running.** Arlesh is open all day and looked at in short bursts, so the most reflexive control on the screen was the one that ended the session: close it and you paid for a cold start the next time you wanted thirty seconds with the board. Worse, the MCP endpoint went with it. An agent could only read your board while you happened to have a window open for it.

  Now there is an **Arlesh mark in the system tray** — the chevrons, flat and white, cut down to three so they stay legible at the size a panel draws them — for as long as the app is running, and the close button puts the window there instead of shutting anything down. Reopening is instant and the window comes back exactly where and how you left it, because it was never gone. **The MCP endpoint keeps answering the whole time** — Claude can read the board while Arlesh is out of your way, which is the point.

  **Getting back to the window:** click the tray icon. One click brings it straight back, another puts it away again — on every platform, Linux included. The right button opens a menu with the same **Show** in it, for when a click is not what you reached for. **Getting out:** **Quit**, in the same menu, or **Ctrl+Q** from the keyboard — both end the app properly, releasing the database and the endpoint. Quitting is the only thing that stops Arlesh now, so it is deliberately the one item in the menu you cannot miss.

  **It is a setting, and it starts on.** *Close to tray* sits in the settings popover (the gear) next to *Light mode*, and it is remembered between restarts. Turn it off and the close button means quit again, exactly as before.

- **Alt+U selects Unblock.** The List View's Unblock preset now has a keyboard shortcut beside the five
  status presets, so the blocked work is one chord away. It sets the List View's preset only — the
  status preset the Mindmap shares is left where it was, and any of `Alt+A` / `Alt+P` / `Alt+S` /
  `Alt+D` / `Alt+B` is the way back out.

- **Ctrl+Alt+/ opens — or shuts — a cell and everything under it.** `Ctrl+/` opens one cell at a time, which is what you want when you are looking for the shape of something and tedious when you already know you want all of it — most of all over a folded Habit history, where it means opening a year, then four seasons, then twelve months, then the weeks, by hand.

  `Ctrl+Alt+/` does the whole branch in one press. It reaches both kinds of closed cell on the way down: an ordinary collapsed cell opens, and so does every level of a folded Habit run, down to the individual days. Each keeps the behaviour it already had afterwards — the Habit history stays open across restarts, an ordinary expansion lasts as long as the session.

  Press it on a cell that is already open and it goes the other way, shutting that cell and everything beneath it, so a second press puts the board back exactly as it was before the first. A re-folded Habit run is properly folded again, not just closed over an expansion still waiting inside it: `Ctrl+/` on it afterwards opens its scope levels, one level at a time, as it would have before.

  It is `Ctrl+Alt+/` and not the `Ctrl+Shift+/` you might reach for first, because that one has opened the keyboard cheat-sheet since the cheat-sheet existed and goes on doing so, from any view and whatever you have selected.

- **A habit occurrence can now hold work of its own.** Tonight's grocery run needs "buy milk"; this week's exercise needs "book the court". Until now there was nowhere to put either. Adding it to the Habit's template made it recur every week forever, and making a Task beside the occurrence left it floating with no connection to the thing it was actually about.

  Now an occurrence takes children — **Tasks, Goals, Commitments and notes**, anything a Task can hold — with the same gesture you use everywhere else: Tab for a child, Shift+T/G/C/I for one of a named kind, and the List View's create keys. What you add belongs to **that occurrence alone**: next week's is not carrying it. It is a real node in every other respect — rename it, scope it, plan it, tag it, complete it, and give it children of its own for a step with sub-steps.

  A commitment added this way opens its editor first, as it does anywhere else, and starts with the occurrence's own window already filled in — so Shift+C on tonight's run gives you a rule for tonight without asking you to say so twice.

  Its window is the occurrence's: an added child cannot be scoped or planned outside the day (or week, or morning) it was written on, exactly as a child cannot escape its parent anywhere else. When the occurrence's window passes, everything on it archives **as a unit** — the occurrence and its children together, still reachable under **All**. Nothing is thrown away.

  **Marking an occurrence done while it still holds unfinished work asks first**, and names what it is about to close over: "*Groceries Mon* still holds 1 unfinished item — buy milk". Say yes and the occurrence is done with the child left where it is; say no and nothing at all has been written. The question only comes up when it has something to say — a note is never unfinished work, and neither is a child you have already ticked off.

  What an occurrence carries **never affects the Habit's schedule**. An unfinished child cannot withhold tomorrow's occurrence, or any occurrence after it, under any Consumption setting: only the Habit's own instances decide whether an iteration has resolved. There is no per-child setting to keep track of, either — the question at completion is the whole of it.

  A pinned future occurrence takes children too, so you can prepare for something you know is coming. Added children show up in the List View and in what an agent reads through the MCP server, and deleting one never touches the Habit's template. Because an occurrence carrying something is an occurrence you have worked on, editing the Habit's scope or repetition now asks the same question it already asks about completed iterations — and choosing *delete instances and regenerate* removes what was added along with the occurrences it hung on.

- **An agent can now ask your board the same question the top bar asks it.** `arlesh_snapshot.load` takes a `filter`, so "what should I start?" comes back as the **Start** preset actually defines it — `{"preset": "start"}` — instead of being guessed at from overdue/active/lapsed dates. **All**, **Plan**, **Start**, **Do** and **Backlog** are all available, along with the Archived and Backlog pills, the tag filters and Private Mode, spelled exactly as the app spells them.

  This matters beyond convenience. Until now the presets existed only inside the app, so an agent reading the board and a person looking at it could quietly disagree about what was live, in a way neither could see. The rules now live in one place and are held to one shared set of examples that both the app and the endpoint are tested against, case by case and preset by preset — so if the two ever start to disagree, the build says so rather than the board.

  What a filtered read narrows: tasks, goals, commitments, notes and the containers that hold them, together with the lifecycles, block reasons and dependencies belonging to them. Flows and their repetitions come back whole, because a Flow's shape is assembled from several rows rather than being one, and a preset has nothing there to judge. Leave `filter` out and the whole board arrives exactly as before.

- **Unlink a node from its `bd` issue, from the editor.** The **Issue** row in the Task, Goal, Commitment and Project editors now carries an **×**. Press it, then **Save**, and the node stops being linked to that issue — useful when the issue was closed, was the wrong one, or came along on a copy, all of which used to mean going back through an agent to undo.

  Nothing is written until you save, and **Cancel** or Escape drops it along with everything else you were editing, the same as every other field. There is no confirmation to click through either: the issue itself is untouched — `bd` still holds it, and this only drops Arlesh's record of which issue the node belongs to — and `Ctrl+Z` puts the link back. The row stays where it is, greyed out and without its ×, until you close the editor, so the dialog does not reshuffle under your pointer; save and open it again, and the row is gone.

  Writing or changing an id is still something only an agent can do over MCP, because only `bd` can say what an id *is*. Dropping one needs no such answer, which is why it is the one case the app can do on its own.

- **Asynchronous tasks.** A Task can now be marked **Asynchronous** — doing it starts a wait rather than finishing something. Send the email, order the part, kick off the build: do those first and the wait runs while you work on everything else. Set it from the switch beside Backlog in the Task editor, or with **W** ("wait") on the selected Task in either view. A flagged Task carries an hourglass in its status-badge row, and the List View's filter gains an **Asynchronous / Not asynchronous** dimension with the usual Any/All/Exclusion modes.

  The flag stays on the Task it is set on and does not pass down to subtasks — unlike Agentic, which marks a whole branch. A subtask of something you are waiting on is usually the work you do *after* the wait.

  The settings popover also gains an **Asynchronous first** switch for the List View, off by default. Turn it on and the list grows an **Asynchronous** section at the very top, collecting every asynchronous task in the filtered list — wherever it sits — along with anything beneath it. Paths are drawn in there as ordinary headers and rows look the same, so a task lifted out of a branch still reads in context; below the section the rest of the list carries on without it. A task is moved, never shown twice, and the Mindmap's hand-set sibling order is left alone. With it off, nothing moves and there is no section.

- **List View: filter by any ancestor, not just the immediate parent.** A new **Antecedent** pill matches a task when the node you pick stands anywhere above it — an Aspect, Domain, Project, Goal or Task, at any depth — so "everything under ARLESH" is one chip, whether the work is one level down or five. Its search box covers **every** node on the board, not only the ones some visible row happens to hang from, because filtering to a branch that has nothing on screen right now is exactly when you need it.

  It carries the same three modes as every other pill, and **Exclusion** is the one that was missing entirely: "everything **except** what is under ARLESH" could not be asked before, in any view. Entering a subtree with `Ctrl+O` is a different gesture and stays exactly as it was — it re-roots the list and drops everything outside the branch, where the pill keeps the whole board on screen and narrows it. One says "show me only what is under ARLESH"; the other says "highlight the ARLESH work among everything else". The commitments band answers the pill too, so narrowing to a branch does not leave commitments from elsewhere sitting above the rows.

  You can also add it **without opening the filter at all**, from the path header above each run of rows — the line that already spells out `Growth › CODE › ARLESH › Features`. **Ctrl+click** a segment to narrow the list to what is under it; **Alt+click** it to drop what is under it and keep everything else. A plain click on a segment still *enters* that subtree, exactly as before. The split is worth holding on to: entering re-roots the list and the branch becomes the whole board, where a Ctrl+click or Alt+click leaves the board alone and narrows it, with a chip at the top naming what is narrowing and one click on that chip putting everything back. Same node, two different questions.

  Each gesture says what it wants rather than toggling, so Ctrl+click on something you had filtered out brings it back in, Alt+click on something you had filtered to swaps it over, and pressing the same one twice changes nothing. Alt+click does take the run you clicked off the screen — that is what filtering a branch out means — so the chip is how you come back. The tooltip on each segment names all three gestures, and the filter popover's search box is still there when you would rather type a name.

- **A Habit's passed iterations now fold into one node you can open.** Every iteration of a Habit left a node behind, and they never stopped arriving. Miss a daily habit for three weeks and twenty-one dead nodes sat between you and the live one; *keep* one for a year and there were three hundred and sixty-five. Under **All**, or with the Archived pill on Include, a single habit could bury the branch it lived on.

  Now a run of passed iterations — those whose window has closed — draws as **one node** naming the Habit and reading what happened in it: **"Journal: 14 passed · 9 done, 5 missed"**, with the dates it covers in its tooltip. The iteration whose window is still open always draws on its own, right where it was. Everything folds, however it went: a kept day counts with a missed one, because what piles up is the *number* of them, and a habit you have kept all year piles up fastest. That also covers a Destructive habit, whose lapsed iterations now disappear into the fold the moment the next window begins instead of accumulating unread.

  **Ctrl+/ opens it** — the same key that collapses any other cell — and it stays open until you fold it again, across restarts. Opening it does not dump a list on you: it draws the run as a **tree of time**, inserting a level only where the run actually spans more than one of that unit. Five days inside one week are five day nodes and no week above them; three weeks inside one month get a week level and no month. Months group under seasons, and seasons under the year they belong to — a Winter that runs over New Year stays one node. Every level reads its own tally ("September · 18 done, 12 missed"), and **the levels come up closed** — opening a year shows you four seasons, not three hundred and sixty-five days. Each one opens on its own with the same key, so you can open a year, look at one month, and leave the rest alone.

  **How many it takes is yours to set.** "Collapse habit history after" sits in the gear popover with the other display settings, starts at **3**, and applies to every Habit at once. Below it, iterations draw as they always have — two passed days are not a pile.

  The folded node is a way of *drawing* iterations, not a thing in its own right: **arrow keys reach it and leave it** like any other cell — onto it from its neighbours, off it to them, into its levels and back out to the rest of the board — and Ctrl+/ opens it, but it has no status to cycle, no editor, and nothing to drag. Your filters still decide which iterations exist — the node stands for whichever ones the current preset kept, and disappears entirely when none of them survive. Nothing about the iterations themselves changed: they are still worked out fresh each time, and nothing new is written down about them.

- **Copy a Flow, and copy a flow item within its template.** Copying a Flow used to do nothing at all — the paste reported it as skipped and left you to rebuild the thing by hand, item by item, cycle pair by cycle pair. But a new Habit is almost never invented from nothing; it is the one next to it with a different schedule or a different target. Now **Ctrl+C on a Flow and Ctrl+V anywhere a Flow can hang gives you the whole thing again**: the template, its items, their Cycle Scope / Cycle Plan pairs, the dependencies between its items (rewired onto the copy, so the copy waits on itself and not on the original), its privacy, and the **Recurrence** — Start anchor, Gap, end and Consumption. **A copy of a Habit is a Habit**, recurring on the same schedule from the same anchor. A copy of a commitment Habit is a commitment Habit, with the one Consumption a commitment is allowed carried across intact.

  The copy's **Target Node** follows the same rule everything else does: a Flow that never named one targets *its own parent*, so the copy's instances land wherever you pasted it, while a target you had pointed somewhere on purpose keeps pointing there.

  Two things stay with the original. **What you have already done** — a copy has not been done, so it starts with no ticks and none of the original's history. And **anything the Flow has already started**: those are real Goals and Tasks standing on your board, and copying a template does not duplicate finished work.

  The Start anchor is **not** moved to today. The copy is about to be edited anyway, and a rule that quietly re-dated it would be the bigger surprise — so a copy of a daily Habit you started in July will render every iteration since July until you give it a schedule of its own.

  **Flow items copy too**, within their own template: copy a step or a block and paste it onto the flow or onto another item inside it, and everything nested under it comes with it, cycle pairs and all. Pasting one into a *different* flow is still refused and says so in the skipped-paste toast — its Cycle Scope is measured against its own flow's window, and another flow's window is not the same window.

- **Ctrl+Z now works.** Nothing in Arlesh was undoable. A delete cascaded through a subtree, a paste wrote one, a drag reparented a branch — and every one of them was final. The only recovery was doing it back by hand, if you could still remember what "it" had been.

  **Ctrl+Z** reverses the last thing you did to the board, and **Ctrl+Shift+Z** (or **Ctrl+Y**) puts it back, in both the Mindmap and the List View. Both appear in the cheat-sheet with everything else.

  What it reverses is **one thing you did**, not one thing the app did. Pasting five nodes is one press, not five. So is deleting a multi-selection, deleting a node that took a subtree with it, inserting a parent above something, and dragging a branch somewhere that narrowed its descendants' windows on the way. Anything that isn't one of those is still a step of its own — editing a title, toggling a status, moving one node — so there is no action the stack quietly declines to hold.

  **The board tells you what it just did, and every press gets an answer.** After an undo a notice names it — "Undid: paste 5 nodes", "Undid: delete 4 items" — and after a redo, "Redid: …" of the same. An undo that redrew half the board without saying why would be worse than no undo. Press Ctrl+Z with nothing left to undo and it says **"Nothing to undo"** — Ctrl+Shift+Z, **"Nothing to redo"** — so an empty stack is never mistaken for a key that didn't register. That reads differently from a reversal that *couldn't* be applied, which says **"Couldn't undo: …"** with the reason: nothing to undo is a fact about the board, where a refusal means the change is still sitting on the stack, the board is exactly as it was, and the same press will work again once whatever blocked it is gone.

  **Ctrl+Z means what it usually means while you're typing.** Inside a title, an editor field or any text box it's the field's own undo, not the board's, and behind an open modal or the cheat-sheet it does nothing — the same rule every other shortcut in the app already follows.

  Two things it deliberately doesn't do. It does not undo **what you're looking at**: filters, presets, the subtree you've entered and your selection are how you're reading the board, not changes to it, and Ctrl+Z is not a back button. And it never reverses **an agent's** writes — anything Claude changed through the MCP endpoint is recorded but stays out of your stack, because Ctrl+Z is for undoing what *you* did. The stack is per session and starts empty each time the app opens.

- **List View: you can create and delete tasks without leaving it.** Noticing a missing task while working through the list used to mean switching to the Mindmap, finding the right parent on a canvas, creating it there and switching back — enough friction that the task often never got written down at all. Getting rid of one meant the same detour in reverse.

  Three ways in, the same ones the Mindmap already offers. **Shift+Enter** creates a **sibling** of the selected row; **Tab** creates a **child** of it, so breaking a task into steps happens where you noticed it needed breaking. Both create a **Task** — no other kind is creatable from List View — and both read the parent off the selection, so with nothing selected there is a third way: each **path header now ends with a `+`**, and it adds under that header's last node, which is exactly what the header already says. Both chords are in the `Ctrl+Shift+/` cheat-sheet, and neither fires while a rename or a modal has the keyboard, so Tab cannot create a task while you are naming one.

  **Delete** removes the selected row, and it is the Mindmap's delete in every respect that matters: the same key, the same confirmation, the same warning that a row takes everything beneath it, and the same single **Ctrl+Z** to put it all back. It acts on the one row you have selected, and does nothing with nothing selected. A commitment deletes like any other row; a single repetition of a Habit does not, and says why rather than appearing to do nothing — the thing behind it is the Habit's template, which is not what deleting one day's occurrence should take away. Afterwards the selection steps to the next row down, or up when you deleted the last one, so you can keep going without reaching for the mouse.

  A new task arrives **To Do** and opens straight into its title, so creating and naming are one motion: **Enter** commits it, and **Escape** throws the task away rather than leaving a nameless row behind — a mistaken create costs nothing. A sibling of a Task you had marked Agentic is marked too, just as it is on the Mindmap. The new row is **held on screen while it stays selected**, whatever the filter says about it: create a To Do task under the **Do** preset and it does not vanish mid-keystroke, and cycling its status while it is still selected does not eject it either. Move on to another row and the filter has it back. It appears on the Mindmap immediately, because the two views are one tree.

- **List View: the list scrolls with you, and `J`/`K` let you read ahead without losing your place.** Arrowing down past the bottom of the window used to leave the selected row off screen — the list looked like it had stopped responding, when in fact it was selecting rows you could not see. Now the view follows the selection: each row you arrow onto is brought into view, and only just far enough, so a row already on screen stays exactly where it is rather than jumping to the middle.

  Reading ahead is a separate gesture. **`J`** and **`K`** scroll the list down and up, and they leave the selection alone, so you can look at what is coming without giving up the row you are working on — even once that row has scrolled out of sight. A tap nudges the view by about one line of text; hold the key and the list glides on at a steady, readable pace rather than lurching a row at a time, and it moves at the same speed whatever your keyboard's repeat rate is set to. Press `↓` or `↑` and the view comes back to the selection, because the arrows move the selection and the view follows it. Both bindings are in the `Ctrl+Shift+/` cheat-sheet. The Mindmap is unchanged: it already pans with the arrow keys when nothing is selected, in both dimensions.

- **Seven keys that put the right kind of thing where you want it.** A new cell has always inherited its parent's type, so putting a Task under a Domain meant Tab, then cycling through the types to reach Task — three keystrokes and a detour through the cycle order, every single time. Now **Shift+D**, **Shift+P**, **Shift+G**, **Shift+T**, **Shift+C**, **Shift+I** and **Shift+F** create a **Domain**, **Project**, **Goal**, **Task**, **Commitment**, **Info** or **Flow** directly under the selection, and drop you straight into naming it. Shift+F and Shift+C open an editor instead, since a Flow and a Commitment are both set up before they exist rather than renamed afterwards — a Commitment because it needs a window to mean anything, and the editor is where you give it one (or leave it to inherit the window above it). Save it with no window anywhere in reach and the editor says so and stays open, right next to the field that fixes it.

  Where the kind cannot live, **nothing is created and the app tells you why** — press Shift+G on a Task and you get "Goal can't sit under Task — only under Aspect, Domain, Project, Goal", so the same keystroke that refused you also answers where it *would* have worked. It will never quietly put the node somewhere else: landing a step above where you pointed is worse than not landing at all. That notice now sits at the bottom of the screen and wraps, so a long one reads in full instead of running off the left edge. With nothing selected the seven keys do nothing, like every other Mindmap key. Bare **F** still converts the selected cell to a Flow, and **Tab** is unchanged. All seven appear in the keyboard cheat-sheet (**Ctrl+Shift+/**).

- **Tasks can now be marked Agentic: this is work an agent could take.** There was no way to say it, so finding the tasks worth handing off meant remembering which ones they were.

  Open a Task's editor, expand **Advanced**, and there are three choices: **Inherit**, **Agentic**, **Not agentic**. Without opening anything, **A** marks the selected Task agentic — in either the Mindmap or the List View — and pressing it again takes the mark off. It is a plain on/off switch on what the Task currently reads as, so every press changes what you see: one press on any unmarked Task marks it, and one press on a Task that shows the badge — whether it set the flag itself or inherited it from above — gives it an explicit **Not agentic** and the badge goes. Because it works on what the Task reads as rather than on what is stored, **A** never leaves a Task on **Inherit**; putting one back there is the editor's job. **Alt+A** still jumps to the **All** preset, exactly as **B** and **Alt+B** have always sat side by side. Mark a Task agentic and a small **bot head** appears in its badge row, on the Mindmap and in the List View alike. Everything beneath it reads as agentic too, so marking a whole branch — a project's worth of agent work — is one edit rather than one per task; the badge shows on every task in the branch, not only the one you set. Any single Task inside it can be taken back out with **Not agentic**, and anything under *that* can be marked agentic again, so the exceptions nest as deeply as the work does. **Inherit** is where every Task starts, and it says underneath it what it currently resolves to, since "inherits nothing" and "explicitly not agentic" look identical otherwise.

  In List View, **Agentic / Not agentic** joins the filter pills, with the same Any/All/Exclusion behaviour as every other dimension, so "show me everything agentic that isn't blocked" is two clicks. It is a filter on what the task *reads as*, inherited flags included.

  The flag is **independent of delegation**: it says the work suits an agent, where a delegate says who holds it, so a Task can be both, either or neither and the delegated/undelegated filter is unaffected. Only Tasks can be agentic — a Goal is a desired state and a Commitment is kept rather than done, not performed — so converting an agentic Task into any other kind drops the flag and the conversion prompt names it among what it would lose. Copying a Task copies the flag, and so does **Shift+Enter**: create a sibling from a Task you had marked agentic and the new one is marked too, rather than arriving blank next to it. What it carries over is the source's *own* answer — if the source was only inheriting an agentic parent, the sibling inherits it the same way rather than being pinned to it, so changing the parent later still moves both. **Nothing is dispatched**: the app never starts, messages or hands anything to an agent; the flag is a label on your own board, and the one-click delegate button that belongs beside it is still to come. Every existing Task starts out inheriting.

- **Commitments: a place for the things you *keep* rather than *do*.** "Asleep by 23:00." "No social media today." Filed as a Task these were wrong in both directions — a Task is finished by doing something, so an untouched one whose window passed read as **Missed**, while an untouched "no social media today" may well have been kept perfectly. Filed as a Goal they were wrong too: a Goal can be Achieved but never *Broken*, so there was no way to record having failed one. The daily thing most worth a record of was the one thing the app could not represent.

  A **Commitment** is a new kind of node, sitting beside Goal and Task. It lives anywhere a Task can, holds Tasks (the supporting steps — "phone on charger", "set alarm") and other Commitments ("no social media this month" holding each day's), and carries a window like everything else. Instead of a status it carries a **Verdict**: **Unresolved**, **Kept** or **Broken**. Reach one with **Ctrl+↑/↓**, which now cycles Domain → Project → Goal → Task → **Commitment**.

  **Nothing ever decides the verdict for you.** Not the window closing, not finishing every child task — the app credits you for the outcome, never for the sub-steps. "Unresolved" means *you have not said*, and it stays that way until you do.

  In **List View**, commitments now get their own band across the top, above the task rows, so today's rules read as a standing header rather than being scattered through your work. Each one has two controls side by side — a **tick** and a **cross** — because keeping and breaking are equal outcomes and Broken should never be one stray press past Kept. Press **Enter** on a selected commitment — in either view — to walk its verdict round — Unresolved → Kept → Broken → Unresolved — or **X** to record Broken outright from wherever it stands, so a misclick is always a keystroke or two from being undone. On the Mindmap a commitment draws as a **shield** — the only straight-edged glyph among the round ones a Task, Goal, Habit and Flow use, so it cannot be mistaken for a task even at the smallest node size — and the shield itself says where the verdict stands, without your having to read the badges. It is **hollow** while you still owe an answer and **solid** once you have given one; a broken commitment's shield is **split down the middle**, and one whose Verdict Window ran out before you said anything is **struck through**. All four tell each other apart at every size a node is drawn at, down to the deepest branches. The badges under the node say only what the shape does not — its window, whether it is archived, its tags — so the verdict is stated once, on the node itself, rather than twice within a few pixels.

  The presets know the difference. **All** shows every commitment including past verdicts, so you can look back over what you kept and broke. **Plan**, **Start** and **Do** show what you have yet to judge. And **Plan alone also keeps a commitment you have already broken, as long as its window is still open** — a rule you broke this morning is a live problem until midnight, where one you kept is settled. You can also filter by verdict, to pull up everything you broke this month.

  A commitment **must** have a window, its own or one inherited from above — a rule held over no window could never come due, so the app will not create one. But it asks rather than refuses: **Commitment** is offered in the type cycle whether or not there is a window in reach, and converting something that has none stops and asks you for one, with Cancel leaving the node exactly as it was. Nothing is written until you answer, so there is no half-converted node either way. Inheritance does the work in the ordinary case: put several of tonight's commitments under one scoped parent and none of them needs a window of its own — and nothing asks you for a window a node already inherits. A child's window has to fit inside its parent's, as everywhere else.

  Because last night's verdict is often recorded the next morning, each commitment can have a **Verdict Window**: how long after its window closes you can still answer, counted in days, weeks, months or seasons — independent of the commitment's own window, so a monthly commitment can stay answerable for two days. Set it once on a parent and the whole subtree inherits it. When it runs out on an unjudged commitment, the commitment is archived **still unresolved**: not having judged something is part of the record too, and **All** still shows it.

  Double-click a commitment on either view, or press **E** on it, and its editor opens: the title, the three verdicts side by side as equal choices, the window, the Verdict Window, tags and Private. Commitments are deliberately quiet about a few things, and the editor shows it by simply not having the fields — there is no Plan, no on-exit behaviour, no delegate and no dependency list to leave empty. They are never scheduled (the window *is* the commitment), never delegated, never blocked, and take no part in the dependency graph. Converting a Task into one tells you first what it will drop — its Plan, its delegate, its dependencies — and converting back tells you the verdict is going, because "done" is not "kept" and the app will not pretend otherwise. Tags, privacy and the `bd` issue link survive the trip in both directions. A Flow's **Instance Type** now offers **Commitment** beside Goal and Task, so a nightly rule recurs through the same Habit machinery your repeating work already uses. Pick it and the flow editor gains a **Verdict Window** of its own — set once on the Habit, it governs every repetition — so last night's instance stops asking to be judged once the time to judge it has passed, rather than sitting there answerable for ever. Leave it empty and they stay answerable indefinitely, exactly as a commitment with no Verdict Window anywhere above it does; switch the Habit back to Goal or Task and the window is cleared rather than left behind where nothing would read it. An instance you never judged archives still unresolved, exactly as a one-off commitment does, and is never recorded as missed. A repeating rule also can't be set to throw away the nights you didn't answer, or to hold back tomorrow until you answer today: the Verdict Window is what bounds it, and the app now refuses the other settings instead of letting you pick one that quietly contradicts the kind. A repeating rule holds only steps, never sub-goals — a Commitment has nowhere to put a Goal — so **Ctrl+↑/↓** no longer offers to turn one of its items into a goal, and a repeating rule that already has sub-goals will not let you switch it over to being a commitment. Both used to be one keystroke away from a Habit that quietly produced no repetitions at all and only said so in a banner afterwards. Migrations `0027` and `0028` add the new kind and the repeating Verdict Window.

- **Tasks can now be put in the Backlog: a deliberate "not now" that isn't deleting it or lying that it's done.** A Goal or a Project could always be **Frozen** — set aside, out of Plan and Start, still there when you want it — but a Task had only To Do, In Progress and Done, none of which mean that. So everything you weren't working on this month sat in Plan and Start beside everything you were, and the presets you rely on to answer "what should I start" were diluted by work you'd already decided against.

  Open a Task's editor and there is a **Backlog** switch: turn it on to set the Task aside, off to bring it back. Only a Task has one; a Goal or a Project is still set aside by its own **Frozen** status. Without opening anything, **B** does the same to the selected Task in either the Mindmap or List View, and **B** again takes it out. A backlogged Task disappears from **Plan** and **Start** along with everything beneath it — set a piece of work aside and its sub-steps go with it — while **All** still shows it, so nothing you deferred is ever actually lost. A **tray** badge on the node says it is set aside; it is deliberately not the snowflake, because Backlog and Frozen are different states.

  To get back to what you deferred, **Alt+B** jumps to a new **Backlog** preset — available in both views — showing only backlogged work and its subtrees, so pulling something back into the week is a browse and a keypress rather than a search. There's also a **Backlog** pill in the filter popover's Advanced section, beside the Archived one and behaving exactly like it: leave it alone and the preset decides, set it to **Include** to see backlogged work under Plan or Start anyway, or **Exclude** to hide it even under All.

  Backlog is a separate axis from To Do / In Progress / Done, so a Task you'd started keeps saying so while it's set aside, and you can still mark it Done if you finished it anyway. One rule holds the ideas apart: **a Task is never both backlogged and planned.** Backlogging a Task that has a Plan asks you first and offers to clear the Plan and set it aside in one go — declining leaves both the plan and the Task exactly as they were. Going the other way needs no question: scheduling a backlogged Task simply puts it back in play, and says so with a toast rather than changing it quietly.

  Two things worth knowing. Backlog is **not protective**: a Task with a Time Scope that you set aside will still lapse as **Missed** when its window closes unfinished, flagged as a conflict — exactly as a Frozen Goal does. And Frozen and Backlog don't translate into each other, so converting a Frozen Goal into a Task still gives you a plain To Do Task, as before — and converting a backlogged Task into a Goal, Commitment, Project, Domain, Tag or note takes it out of the Backlog, which the conversion prompt now names among the things it would drop, so it's something you agree to rather than something you find out about later. Migration `0026` adds the stored state; every existing Task starts in play.

- **Tabs.** Arlesh can hold several places on the board open at once. A tab remembers *everything* about the view in it — which part of the board you entered, whether you were in the Mindmap or the List, the branch direction, every filter you had set in both views, what you had selected, which branches you had collapsed and where the canvas was panned and zoomed to. Switching tabs swaps all of it in one go, so "what's left in Bugfixes under Start" and "what am I doing today" can both be open, and going back to one puts you exactly where you left it rather than costing a navigation and a re-filter.

  The gestures are the ones you already know. **Ctrl+T** opens a tab, and it opens *where you are* — inside a subtree, the new tab starts there too, so looking at something nearby is free. Everything else about it is fresh: a new tab does not inherit your filters. **Ctrl+W** closes one, **Ctrl+Tab** and **Ctrl+Shift+Tab** cycle, and **Ctrl+1** to **Ctrl+9** jump straight to a tab by position. These keep working while a dialog or the cheat-sheet is open, unlike the view shortcuts. The strip above the top bar has a **+**, an **×** on each tab, closes on **middle-click**, and reorders by **dragging**. Each tab is named after the part of the board it is in; one showing the whole board reads **All**. **You can name a tab yourself** — right-click it and choose **Rename tab**, and the label becomes a box you type in: Enter to keep it, Escape to change your mind, clicking away keeps what you typed. A name you give sticks: the automatic name goes on quietly tracking where the tab is underneath it, so wandering off into another part of the board doesn't wipe the name off, and **emptying the box hands the tab back to the automatic name** — the one for wherever it is now, not the one it had when you named it. The empty box shows you that name in grey before you commit to it. A name too long for a tab is still readable: hover for the whole thing. The same menu can **close** the tab, which is the × by another route.

  Two things stay shared on purpose. **The clipboard** — cutting or copying in one tab and pasting in another is most of the reason to open a second one. And **the theme**, so the app doesn't change colour as you move between tabs. Your **Path icons** choice is shared too, since it's a matter of taste rather than something about one particular view; the **Vertical layout** switch is per tab, since one wide subtree may want to be vertical while another doesn't.

  **Your tabs come back when you reopen Arlesh** — their order, which one you were on, any name you gave one, and each one's location, view, branch direction and filters. What doesn't come back is the working state: the selection, the collapsed branches and the zoom all start clean, because coming back to a selection from three days ago is worse than coming back to none. If you'd entered a part of the board that has since been deleted, that tab opens at the whole board instead of showing you nothing. **Nothing you had set is lost in the upgrade**: your existing view, branch direction and filters reopen as your first tab, exactly as you left them.

  **The board alone.** **F11** hides the tab strip and the top bar so the board fills the window, and **F11** again brings them back. **F** on its own does the same whenever nothing is selected — with something selected it still converts that node to a Flow, so the key never takes a gesture away from you. It hides Arlesh's own chrome rather than resizing the window, so it works just as well in a window as maximised, and every tab shortcut keeps working while the strip is hidden. It is not remembered between runs: Arlesh always reopens with its chrome, so you can never be stranded in a view with no visible way out.

  Not in this change: pulling a tab out into its own window, or splitting one window into panes.

- **Claude (or any MCP client) can now read your board while Arlesh is open.** Point it at `http://127.0.0.1:4747/mcp` — `claude mcp add --transport http arlesh http://127.0.0.1:4747/mcp` — and it can answer questions about your actual tasks instead of being told what's on them: what's overdue, what a goal's subtree looks like, what a Task is blocked on and by what, when something is scheduled, what a Habit repeats and how many of its repetitions you've done, who and what is in the knowledge base. It reads the same data the app draws from, so it is never looking at a stale copy. **It cannot change anything** — there is no way for an agent to create, edit, complete or delete a Task, Goal, Flow, Project or note through it. The endpoint only exists while the app is running, only listens on your own machine, and refuses connections from a web page; if something else already has the port, Arlesh starts normally without it and says so in the log. Set `ARLESH_MCP_PORT` to move it. One limit worth knowing — "read-only" has one honest exception: asking for the whole board works out each Habit's repetitions, and working those out records the weeks and days they land on, exactly as opening the Mindmap does. Nothing you entered is touched.

- **An agent reading your board now gets all of it, however big the board is.** Asking for everything used to come back as one enormous response, and past a few hundred items an assistant would reject it outright — so on a real board the first thing an agent was told to do simply failed. It now arrives a page at a time and the agent keeps asking until it has the lot, which it does on its own without being told. Nothing about the data changed, only how much arrives at once.

- **A Task, Goal or Project tracked as a `bd` issue now says which one.** Open its editor and the issue id — `Arlesh-5fs` and the like — sits under the title as an **Issue** row. It is there to read, not to edit: nothing in the app can type, change or clear it, because `bd` owns the issue and Arlesh only mirrors which one a node belongs to. The link is set from outside the app (the MCP server), so for now most nodes have none — and a node with none shows nothing at all in its place, no empty row and no placeholder. Changing a node's type keeps its link: a tracked Task you convert to a Goal, or to a Project, is still tracked afterwards. The one exception is converting it to a **note**, which has nowhere to store the link — that conversion now tells you the issue link will be cleared, and names the issue, before it goes ahead.

- **Ctrl+O in List View finds any part of the board by name and drops you inside it.** The chord used to do nothing outside the Mindmap, so the view built for working through tasks was the one place you couldn't get to a part of the board by name. It now opens the same search box the Mindmap uses, over every kind of thing on the board — Aspects, Projects, Domains, Goals and Tasks, not just tasks — and picking one **enters it**, exactly as right-clicking a node and choosing Enter does on the Mindmap: the list re-roots there and shows only the tasks beneath it. Getting to everything under ARLESH is two keystrokes and a word. Where you are shows in the top bar as the same path the Mindmap uses, and you get out the same way too — **Shift+Esc** up one level, **Ctrl+Esc** straight back to the whole board, or by clicking any step of that path. Plain **Esc** still just deselects the row you were on.

  Two things worth knowing. **The two views share one location:** enter a subtree in the List View, switch to the Mindmap, and you are still standing in it — and the other way round. And this is *not* a filter: your filter chips, your status preset and your selected row are all left exactly as they were, and entering somewhere composes with whatever you had already filtered by rather than replacing it. The Mindmap's Ctrl+O still means what it always did.

- **The top bar now says which subtree you are in, in both views.** Going into a part of the board used to leave you working out where you had landed from the ways back out of it, with nothing naming the place itself. The centre of the bar now names it, so `CODE` reads as `CODE` instead of having to be inferred from the level above it — and the name is the last step of the path that leads to it, so one line tells you both where you are and how you got there. It shows up in the **Mindmap** as well as the List View, which had exactly the same gap.

- **Inside a subtree, List View paths no longer repeat the part you already entered.** A row's path header used to start at the subtree root, so inside `CODE` every single header began with `CODE ›` — a word repeated down the whole screen that told you nothing, since the top bar now names it. Headers start below it instead: inside `CODE`, a header reads `Goal Alpha`. Rows that sat directly under the place you entered have nothing left to name and now show no header at all, rather than a blank one. Indentation still lines up with the headers — a task nested under another task is still indented under it.

- **A keyboard cheat-sheet**, opened with **Ctrl+Shift+/** or from the settings popover's **Keyboard shortcuts** entry. Lists every binding in the app grouped into Global / Mindmap / List View, with the chords that share an action merged onto one row (so the four arrow keys read as a single `← → ↑ ↓` line). The list is generated from the same binding table the keyboard handlers dispatch from, so it can't fall out of date with what the keys actually do.

### Changed
- **A released wait archives itself once its window has passed.** A wait with no window is archived as soon as it is released, and answering a question releases it. A wait still pending never archives itself; it goes Overdue as before.

- **Delegated Tasks are no longer treated as archived.** The Archived pill no longer shows or hides them: the new Delegated pill does.

- **Copying a node copies the Flows, Commitments and waits under it.** Copy and paste a Project, Domain or Goal and every Flow hanging under it now comes along — template, items and Recurrence — in the same single undo step. Commitments and waits anywhere in the copied subtree come along too, as they are, with everything under them; they used to be dropped without a word, and so did some Tasks and Goals under a copied Domain. Copies of work a Flow started still say which Flow they came from. A copied Habit starts fresh, with no completions. Its Target Node follows the copy when the target was copied too, and keeps pointing at the original when it was outside what you copied.

  Rows added to a Habit occurrence can't come along, because the copy regenerates its own occurrences. The paste toast names them, so you can copy them across on their own.

- **"Blocked by" names the dependency by its short id.** A Task blocked by unfinished work now reads "Blocked by task 6f3 (Write spec)" — the short id an agent sees over the MCP — instead of the row number, on the board, the cards, the editor and in `arlesh_tasks.get`.

- **Agentic waits are no longer drawn in the Zen View's Expectations strip.** The strip now shows only waits on people. An agent's question is drawn on its Review card, and an agent's wait on something else, such as CI, is the agent's own business. Both still show under their task in the Mindmap and the List View.

- **Enter and Alt+Enter on Agentic tasks.** `Enter` cycles an Agentic task Review → Doing → Done → To Do, and takes an On Agent task over (Doing). `Alt+Enter` hands a task you are Doing back to its agent (On Agent). On any other Agentic status it now says so out loud instead of setting Started.

- **The MCP speaks the Agentic statuses.** An agent sees an Agentic task as `todo`, `on_agent`, `review`, `doing` or `done`, and every task's status now says which set it belongs to. An agent claims a task with `on_agent` (from `todo`, needing a Spec as before), hands it back with `todo` and finishes it with `done`. It may not set `doing`, which says you are working, or `review`; to hand a task to you it asks a question, and the task reads `review` until you answer. A compare-and-set may expect `review`. The top bar's agent status now counts tasks waiting for your review and tasks on an agent.

- **Zen shows only what you hold.** A delegated Task no longer gets a card on the Zen grid, even while it is In Progress. Do still lists it. A card you have just delegated stays where it is until you move the selection off it.

- **No red X over the Time Scope clock.** An item whose window has passed no longer draws its clock badge crossed out, on the Mindmap, in the List View or on the Steps, Plan and Zen cards. An Overdue item shows the amber border, and a Missed or Completed one shows the archive box.

- **A Habit keeps a clock instead of a Consumption.** The Flow editor's Consumption, Overlapping / Blocking and Catch-up choices are gone. A Habit now has a **Clock**: **Window** (a new occurrence every window, done or not) with a choice of what happens to one you miss — **Archive** (it is archived as Missed), **Owed** (it stays open and is flagged Overdue beside the later ones) or **Overdue** (it is archived, and the one open now carries it, Overdue until you complete one) — or **Interval** (below).
  Every existing Habit keeps behaving as closely as it can: a Destructive one is now Window + Archive, an Overlapping one Window + Owed, and every Blocking one, whatever its catch-up, Window + Overdue. A Blocking Habit's old open occurrence, if it was not the current one, is now archived as Missed with everything on it, and the current window's occurrence is the open one.
  Under Window + Overdue the open occurrence is drawn "Water the plants W3 from W1": its window reaches back to the first one you missed, and it has the amber Overdue border until it is done.
  Habit occurrences can now be Overdue — Owed and Overdue ones past their due, Interval ones past their window — and a Habit occurrence's Task editor offers the **Due** field, so you can give one occurrence a due of its own.
  In the Flow editor the Habit settings are sparser and start with the clock, then what happens to a missed one, then Starts, Gap and Ends. Each choice explains itself in its tooltip.
  Under Window + Owed, an occurrence still open past its window is never folded into the Habit's collapsed history: it stays drawn beside it, where you can see it is owed.

- **Settings: *MCP access* is now *Agents*.** The settings page with the MCP roots and the endpoint has been renamed **Agents**. It now also holds the agent capacity lock and the switch for the agent status in the top bar.

- **"Keep" is now "Keep Overdue".** The choice for what happens when a Task's or Goal's Time Scope passes unfinished now reads **Keep Overdue** / **Archive**, in the editors and on Steps View cards. It means what it did — the item stays and is flagged Overdue — and it is also what gives the item its default Due.

- **Inside a Flow template, the create keys make flow items.** On the Mindmap and in the Steps View, with a Flow or one of its items selected, `Tab` and `Shift+T` now make a Task item and `Shift+G` a Goal item. Before, `Tab` added an item of whatever kind the Flow implied, and `Shift+T` and `Shift+G` were refused. A Flow template holds only Task and Goal items, so `Shift+C` and `Shift+E` there say "Commitment can't be a flow item" (or "Expectation…"). A Goal item still goes only under the Flow or another Goal item, and a Commitment Flow holds no Goal items. A Step standing on a Flow now offers Task and Goal in its "+" menu. Outside Flow templates nothing changes.

- **Tab always creates a Task; Shift+H creates a Habit.** On the Mindmap and in the Steps View, `Tab` now makes a Task child whatever is selected, instead of a child whose kind depended on the parent (a Domain under an Aspect or a Domain, a Project under a Project, a Goal under a Goal, a Commitment under a Commitment, an Info under an Info). Where a Task cannot go — a Tag, an Info note, an Expectation, a folded run of Habit history — `Tab` creates nothing and a toast says where a Task does go. Inside a Flow template `Tab` still adds the template's next item. Every other kind stays on its own `Shift`+letter chord and in the Step's "+" menu.

  `Shift+H` is new: it opens the new-Flow editor as a **New Habit**, with Repeating already switched on, so you can set the recurrence and save the Habit in one step — one `Ctrl+Z` takes it back. It works wherever `Shift+F` does, and the Step's "+" menu offers Habit too.

- **Start hides work whose window has not begun yet.** A Task, Goal or wait whose Time Scope is still in the future no longer shows under the Start preset, in the Mindmap and the List View alike — just as work whose window has passed does not. A sub-step with no Time Scope of its own goes with its parent; one whose own window is already open still shows, with its parent above it. A wait still ahead takes its check tasks with it, even when a check is already due; the check stays due and shows again under the other presets. Plan, Do, All and Backlog are unchanged.

- **"Collapse habit history after N" has moved to the General settings page.** It now applies to the Steps View as well as the Mindmap, so it lives with the other app-wide settings rather than on the Mindmap page. Your current value is kept.

- **Searches leave archived nodes out.** `Ctrl+O`, the node results of `Ctrl+F`, and the Under and Depends on boxes in the Filter menu no longer offer archived nodes — including delegated tasks, which count as archived. Turn on **Include archived nodes in search** in Settings → General to see them again.

- **A denser Filter menu, with your filters shown where you set them.** The Filter menu is a little wider and lays every dimension out as one compact labelled row: in the List View, Under, Tags and Depends on, then Scope and Yes / no, then Task, Goal, Project and Verdict; elsewhere, Tags. The switches sit at the top in every view — the row kinds or Info / Flow, Private, and the Archived and Backlog pills, which no longer hide behind "Advanced" and now work in the List View too. Antecedent is now called **Under** and Dependency **Depends on**.
  A value you add stays in its row wearing its mode, like its chip in the top bar: click it to cycle All → Any → Not, press Delete to remove it. Tags, Under and Depends on each have their own search box. Blocked, Agentic and Asynchronous are one pill each — "Blocked", or with Alt, "Not blocked" — and take Any too: Agentic (Any) with Asynchronous (Any) shows what is either.
  Adding now defaults to **All**: click or Enter adds as All, Shift adds as Any, and Alt adds as Not. Chips cycle All → Any → Not. The keyboard cheat-sheet (`Ctrl+Shift+/`) lists these in a new Filters section.
  While Private Mode is on, the List View also offers a **Private** pill — only private rows, or with Alt, only the rest. Turning Private Mode off removes it, and a message says so.
  The **Alt+Shift+T / C / E** shortcuts for showing or hiding Tasks, Commitments and Expectations are gone: on keyboards where Alt+Shift switches layout they never worked, and could trigger other shortcuts instead. Toggle the kinds in the Filter menu, or type their name into `Ctrl+F`.
  With the Filter menu open in the List View, letter keys work on it: **T / C / E** show or hide Tasks, Commitments and Expectations (Shift shows only that kind), and **A / W / B / P** add Agentic, Asynchronous, Blocked or Private (Shift Any, Alt Not; on a set flag the key switches it to that mode, or removes it if it is already in it). **Ctrl+P** in the menu turns Private Mode on or off. The keys are listed in the keyboard cheat-sheet.

- **Start shows a wait even when it has checks; hiding it is now a setting.** Under the Start preset, a pending wait that is checked on used to disappear, leaving only its check task. That was confusing for a wait checked often, such as every hour. Start now shows the wait itself, checked on or not, and its check task still shows beside it by the usual rules. To get the old behaviour back, turn on **Start hides waits that have checks (shows their check task instead)** in Settings → General. It is off by default, applies to every view, and applies to an agent's snapshot filter as well.

- **Overdue tasks can be planned past their window.** A task whose Time Scope has passed while it is still not done (and set to Keep on exit) can now be planned into this week or any later scope, from the Plan View or the task editor's Plan picker, so late work can be rescheduled. Its Time Scope is left as it is, and it still has to fit inside a planned parent's Plan. Tasks that lapsed done or missed, and Habit occurrences, keep the old bound.

- **The Plan View always reads under the Plan preset.** Whatever preset the tab has, the Plan View now shows its work as Plan does, and the top bar draws Plan as active with the other presets disabled — hover one to see why. `Alt+A`, `Alt+S`, `Alt+D` and `Alt+B` say so instead of switching. The tab keeps its own preset: switch back to the Mindmap, the List or the Steps View and it is still there.
  The Plan View's planned pane now opens **split by subscope** — the weeks of a month, the days of a week — by default. If you had turned the split off, it comes back on once; turn it off again from the pane's menu and it stays off.

- **Archiving a Habit repetition takes what it holds with it.** Deleting an iteration's root archives the whole iteration, and archiving one occurrence archives the steps nested under it — as archiving any Task does. An archived iteration counts as over, so a Blocking Habit moves on to the next one without anything being marked done.

- **A Habit's occurrences are ordinary Tasks, Goals and Commitments.** Each repetition now behaves like any other node of its kind, everywhere: `E` opens its editor, and what you save there changes that one occurrence only. You can plan it, set it aside in the Backlog, flag it Agentic or Asynchronous, tag it, give it block reasons and dependencies in either direction, and hang Tasks, Goals, Commitments, Expectations and Infos under it — or cut and paste something onto it. Its window stays its iteration's: the editor shows it and says so.

  Deleting an occurrence archives that one repetition; giving it a status again brings it back. Moving it out of its iteration, changing its kind, or copying it is refused with a reason. A blocked occurrence's status is now gated like any blocked Task's.

- **A wait's check tasks are Tasks.** `E` on a check task now opens its own editor: give it a title, a Plan, tags or block reasons, flag it Agentic or put it in the Backlog. Its status cycles To Do → In Progress → Done like any Task, Done recording the check and taking it back reopening it. The day it fell due stays fixed.

  A Task's spawned wait and a delegated Task's wait are drawn and released like any other wait; a spawned wait's title, tags and schedule still come from its Task's Expectation template.

- **Opening the board no longer writes to it.** Every Season, Month, Week, Day and Part of Day is now worked out from its dates when it is needed instead of being saved the first time something touches it, so loading the Mindmap, List or Plan View — and an agent's MCP snapshot — only reads. Boards with long-running Habits load faster.

  A week that spans New Year is always labelled with the year it starts in (e.g. "Week 53 2026"); it used to depend on which of its days was used first. A retype prompt that warns a Plan or Time Scope will be dropped now names it ("Week 39 2026") instead of showing an internal number.

- **Unjudged Commitment rows no longer carry a marked left edge.** It looked like a selection; the row's glyph already says the verdict is unresolved.

- **An asynchronous task can say what it will be waiting on.** Turning Asynchronous on in the Task editor now shows an Expectation section: a title, tags, a Time Scope and how often to check on it. Fill it in, and while the task is done a wait with those details appears beneath it, to release, archive and check on like any Expectation; reopen the task and the wait goes, and it comes back as you left it if you finish the task again. Leave the section empty and nothing changes from before. `Shift+W` on a task opens its editor straight at that section; `W` still turns Asynchronous on and off.

- **Commitments in the List View work like task rows, and can sit among them.** A Commitment's row now has the ordinary status control — its own glyph — and a click cycles the verdict just as `Enter` does; the separate tick and cross are gone. A new setting draws Commitments and Expectations either in bands above the list (as before) or as ordinary rows at their place in the tree.
  The Plan preset now hides a Broken commitment the way it hides a Kept one, even while its window is open: a recorded verdict is an answer either way. A delegated task is treated as archived — hidden from Plan and Start, and governed by the Archived pill — while what it waits on stays in view.

- **Window numbers only show while several windows are open.** With one window, its title reads
  `Arlesh` as it did before windows were numbered, and the tray's menu is just
  Show and Quit. Open a second window and both titles gain their number, now in brackets —
  `Arlesh [1]`, `Arlesh [2]` — and the tray menu lists each window by that title; close
  back down to one and the number and the list go away again. A window still keeps its number
  while it is open, and gets it back when Arlesh reopens.

- **Start no longer shows work planned for later.** Under the Start preset, a Task whose Plan has not begun yet — planned for next week, say, or for Friday when it is Wednesday — is hidden, in both the Mindmap and the List View, and so is its answer over the MCP server. Its sub-steps go with it unless they carry a Plan of their own that has already begun. A Task whose Plan has already ended without being done stays visible, so missed work does not disappear. Plan, All, Do and Backlog are unchanged.

- **Plan View cards take their aspect's colour flat, no longer fading with depth.** A card in either pane is now washed in its aspect's colour the same way a List View row and a Steps card are, so two tasks from one aspect look alike however deep each sits. The path line under the title uses a muted colour drawn from the card itself, so it stays readable on every aspect in both light and dark themes.

- **The Plan View's two halves each have their own menu, and a pass opens on what still needs placing.** The two switches that lived in the settings gear have moved out of it, into a kebab beside the heading of the pane each one acts on, with two new ones beside them. A control three rows up from the thing it changes has to name which half it means, and a settings popover is somewhere you go once rather than somewhere you reach for mid-pass.

  **Candidates** holds *Show only planned to parent scope* and *Group by path*, both on. **Planned** holds *Split by subscope* and *Include premorning*, both off.

  The left-hand pane holds the relevant work that is either unplanned or planned to the **parent scope** — the scope one rung up from the one you are filling: the month, while you fill a week; the week, while you fill a day. *Show only planned to parent scope* hides the unplanned half, so a pass opens on the work committed a rung up and not yet placed here — the list that shrinks as you work. Untick it to see the unplanned pool as well. A week at a month's edge has both months above it, and work planned to either counts. A Season is the top of the ladder and has no parent, so for a Season the switch is greyed out and the pane shows the unplanned work.

  *Group by path* is now the candidates pane's alone, and is on by default: that pane is read for where work lives, and the pane opposite it is read for when work is planned. A card no longer repeats the path the header above it just gave — the two used to sit on one line narrow enough to clip it.

- **A List View row keeps its aspect's colour, no longer faded by depth, and its text is readable
  on every aspect.** A row used to be filled with its aspect colour at an opacity that changed with
  how deep its task sat, so the same aspect looked different from row to row, and on a pale aspect
  like Steel in the dark theme the text could get hard to read. Every row is now washed in its
  aspect's colour at one fixed strength, the same wash the Steps View uses, and the row's secondary
  text is adjusted so it stays readable on each aspect in both themes. Self and Flow, the two grey
  aspects, are now told apart: Self reads lighter.

- **The view switcher is a dropdown** rather than a row of tabs. With a fourth view the row had
  started to crowd the top bar, and a control that grows with every view is a bar that shrinks with
  every view. The chords are unchanged: `Ctrl+M`, `Ctrl+L`, `Ctrl+P`, `Ctrl+S`.

- **Setting a task In Progress takes it out of the Backlog, and says so.** You cannot be actively
  doing something you have deliberately put down, so starting a set-aside task now clears the flag
  in the same write — one `Ctrl+Z` takes the status and the Backlog back together — and a toast
  names the change rather than leaving it to be noticed. It works from the status control in either
  view and from the Task editor, where the Backlog switch now goes off as you pick **In Progress**,
  the way it already does when you set a Plan. The reverse still works as it did: a task already
  under way can be put in the Backlog and keeps its status, so it says where the work stood when you
  pick it back up. **Do** therefore still shows a backlogged in-progress task — what is underway and
  what you are not planning are different questions — rather than hiding it.

- **The day now turns over at 02:00, not at midnight — and so do the week, the month and the season.** Night runs 22:00–02:00 and belongs to the day it starts on, but a day used to end at midnight, so for two hours every night the two disagreed: by the parts of the day you were still in last night, and by the day scope you were already in today. A daily habit's next iteration appeared at midnight while the day it belonged to had not ended, and last night's still-open one was archived out from under you.

  A day now runs 02:00 to 02:00, and the whole ladder moves with it — a week is Monday 02:00 to the next Monday 02:00, a month the 1st at 02:00 to the next 1st at 02:00. A day therefore contains all six of its own parts, Night included, and a week contains exactly its seven days. Habit iterations are generated and archived on that boundary: at 01:30 yesterday's is still the one that is open, and the new one arrives at 02:00.

  The practical difference is what "today" means after midnight. At 00:30 you are still in the previous date's day: that is the cell the scope picker outlines, the day a task plans into, and the date a new repetition starts from by default. Nothing stored changed — every existing scope keeps its dates and simply covers a window that begins and ends two hours later.

- **Shortcuts that work everywhere are now listed once on the cheat-sheet, instead of once per view.** `Ctrl+Shift+/` had grown into a list that repeated itself: leaving a subtree, searching for a node and opening the filter menu appeared under **Mindmap**, again under **List**, and again under **Plan**, because each view declared them separately. They were never view shortcuts — what they act on is the tab you are in, not the thing drawing it — so they have moved to **Global** and appear there once. The chords themselves are unchanged, and so is where they work and where they don't: all four are still ignored while a modal or an inline rename has the keyboard.

  **`Ctrl+O` now works in the Plan view too**, which it did not before: search every node and enter the one you pick, exactly as on the Mindmap and in the List. Its cheat-sheet line also stops underselling it — it now reads *"Search for a node and enter its subtree"* everywhere, which is what the chord has always done.

  Warning prompts — backlogging a Task that still has a Plan, completing an occurrence that still holds unfinished work — now hold the keyboard for as long as they are up, like every other dialog in the app. A shortcut fired at one of them reached the board underneath in a couple of cases; now none of them do.

- **Switching views moved to `Ctrl`: `Ctrl+M` for the Mindmap, `Ctrl+L` for the List, `Ctrl+P` for the new Plan view — and `Alt+L` no longer switches views at all.** `Alt+L` used to toggle between the only two views there were. With a third, a toggle has nothing to mean: it would have had to become "next view", quietly turning a chord you already have in your fingers into something that depends on where you happen to be standing. Each view now names itself instead, so every one of them is a single press from any other and there is no cycle order to learn.

  **The status presets are untouched.** `Alt+A`, `Alt+P`, `Alt+S`, `Alt+D` and `Alt+B` are still All, Plan, Start, Do and Backlog, exactly where they have always been — which is why the *views* are the ones that moved. `Ctrl+S` is deliberately left free, held for a view still to come, so this is the last time these chords change.

  `Ctrl+P` and `Ctrl+S` are the browser's print and save. Arlesh takes them the way it already takes `Ctrl+W` and `Ctrl+T`, and a rename box or an editor field still gets them first, so a save reflex while you are typing is still just a reflex that does nothing. The view chords also stop working while a modal or an inline rename is open, so a view can never change out from under something you have open on top of it — `Ctrl+Q` and the `Ctrl+Shift+/` cheat-sheet stay live as they always have.

  The cheat-sheet lists all three.

- **One breadcrumb in the top bar replaces the two back buttons and the "you are here" label — and it reaches the middle of a deep chain.** Inside a subtree the bar used to carry three things that all said the same thing: an `↑` back-to-the-root button, a `←` up-one-level button, and, in the centre, the name of the subtree you were in. Between them they could take you up exactly one step or all the way out, so from `Arlesh › CODE › ARLESH › Features` there was no way to get back to `ARLESH` without leaving the subtree and entering it again.

  In their place is the whole path, centred in the bar: `Arlesh › CODE › ARLESH › Features`. Click any step and you go straight there — the first one is the root, so it does what `↑` did, and the one before the end does what `←` did. The last step is where you are and stays plain text, since there is nowhere for it to take you. **Shift+Esc** and **Ctrl+Esc** are untouched.

  A path too long for the bar folds its middle into a **…**, which opens a menu of the steps it dropped so none of them becomes unreachable; the root and where you are always stay on the bar, and the steps nearest you are the last to fold. How much fits is worked out from the actual width of the bar and the titles in it, so widening the window brings steps back. At the root the bar shows nothing at all, as before, and the Filter button stays where it is either way. A screen reader still hears "Inside subtree" rather than a run of bare titles. The path belongs to the tab you are in, and hiding the chrome with **F11** hides it along with the rest.

- **`Enter` now cycles a commitment's verdict — and it works on the Mindmap as well as the List View.** Pressing it on a selected commitment walks **Unresolved → Kept → Broken → Unresolved**, so the whole answer — including changing your mind and taking it back — is reachable without leaving the keyboard; it used to mean "kept", and a second press only cleared it, which left **Broken** with no home on the main key. **X** records Broken outright from any verdict, so saying you broke something never has to pass through saying you kept it, and it is now bound on the **Mindmap** too rather than only in the List View. On the canvas a commitment is both a container and a thing to judge: a single **Enter** cycles the verdict, a **double tap** still enters its subtree, and entering one never records a verdict on the way in — the app waits out the double-tap window before writing, because nothing but you may decide a verdict. The tick and the cross stay List-View-only and are unchanged: two separate, equal controls, each clearing the verdict when you press the one already lit. A repeating commitment's nightly iteration behaves exactly like any other commitment on both views.

- **The delete confirmation now opens with Delete focused, so deleting is press-Delete, press-Enter.** It used to open with **Cancel** focused, which meant confirming a delete — the answer you almost always already know before the dialog appears — cost either a reach for the mouse or a Tab and then Enter, in the middle of a view where every other action is one key. Enter or Space now confirms, the focus ring sits on **Delete** — drawn explicitly now, rather than left to whatever the browser happened to paint over the red button — so you can see what the next keystroke will do. **Tab** also stays inside the dialog: it used to walk out into the app behind it, so getting to **Cancel** by keyboard meant tabbing through half the page and back. One **Tab** or one **Shift+Tab** now moves between **Delete** and **Cancel**, and nothing else about the dialog changes: **Escape** still cancels, clicking outside still cancels, and both buttons still go dead while the delete is in flight so a second Enter can't fire it twice. It behaves the same whether you're deleting one node or a multi-selection, and whether or not the delete takes descendants with it. Only the delete confirmation changed — the warning prompts that list what you'd lose still open with **Cancel** focused, because those exist to be read.

- **Subtasks are now indented under their parent in the List View.** The list used to be flat: “Build the importer”, “Parse the header” and “Handle errors” looked like three unrelated items rather than one job and its two steps. A row now steps in once for each of its parent tasks that is *also* on screen, so the shape of a piece of work reads at a glance and sibling subtasks line up as a group. Indentation only ever counts rows you can actually see — under **Do**, where the parent is filtered out, the subtask sits flush at the left rather than floating in under nothing, and its parent is named in the path header above it instead. A list with nothing nested looks exactly as it did, deep chains stop stepping in before they squeeze the titles, and a Hebrew task indents from the right.

- **A List View row now says where it lives, in full.** A run of tasks sharing a location is topped by its whole chain — `Growth › CODE › ARLESH › Features` — written once above the run instead of repeated on every card and led by an icon for what kind of thing the run hangs from — a Domain, a Project, a Goal — so you can tell without reading the names, and so two identically-titled tasks in different Projects are finally told apart; if you would rather read bare titles, the settings gear now carries a **Path icons** switch that turns that icon off, which appears there only while the List View is on screen and is remembered between sessions. The chain always runs through to the Goal, which is why the **Show goals** toggle is gone: goal context is now always on screen rather than behind a switch (and with it goes the List View's toolbar, which held nothing else). An ancestor the list is already showing as a row of its own is left out of the chain, so the header never repeats what is on screen below it — and conversely, an ancestor the current filter hides *is* named there, so a subtask you see under **Do** without its parent still reads in context. Click any segment to **go there**: the list re-roots at it and shows only what is beneath it, exactly as picking it from **Ctrl+O** does — the top bar names where you have landed, and **Shift+Esc** / **Ctrl+Esc** bring you back out. It is not a filter: your chips and your status preset are left exactly as they were.

- **The mindmap reloads in one request instead of fifteen-plus, so the canvas settles faster after every edit.** Drawing the mindmap needed thirteen separate requests to the database, and then two more *per flow* on top — so a board with ten flows cost thirty-three round trips, paid again in full every time you renamed, moved, created or deleted anything. It is now a single request whatever the board holds. One thing you may notice besides the speed: if a Habit's repetitions can't be worked out — say its Duration was cleared after its schedule was set — that flow used to just quietly show no repetitions at all, indistinguishable from a flow that has none. Now the mindmap still loads and a banner appears at the top of the view listing every flow whose repetitions failed to load, by name. Unlike a toast, the banner stays up as long as the problem does — it isn't tied to a node that might be off-screen, and it comes back on the next load if the flow is still broken, even if you've dismissed it.

- **The NSFW flag is now called Private, and the Work filter is now Private Mode — with the switch turned around.** Marking a node **Private** (the toggle in each editor modal's **Advanced** section) means the same thing it always did: the node and its whole subtree are hidden as a unit. What changed is the default. The old **Work** toggle was off by default and showed everything, hiding marked nodes only once you turned it on; the new **Private Mode** toggle is off by default and *hides* private nodes, and you turn it on to reveal them — so private work stays out of sight unless you ask for it. If you had the Work toggle on, nothing visibly changes; if you had it off, nodes you'd marked are now hidden until you switch Private Mode on in the filter popover. Migration `0022` renames the `nsfw` column to `is_private` on every node table; no flags are lost.

### Fixed
- **Archived Tasks and Commitments no longer show in Start or Do.** A Task archived by hand, or one beneath an archived Task, could still appear in Start, and an archived in-progress Task still appeared in Do and the Zen View. Now anything archived stays out of both unless the Archived pill is on Include.

- **Narrowing a Time Scope from the List View or the Plan View no longer hangs.** When narrowing a window would leave nested items outside it, the prompt to clamp them or cancel now appears in every view. Before, only the Mindmap showed it, so the same save from the List View or the Plan View waited forever.

- **Steps View: `Space` no longer moves a blocked card.** Cycling the status of a blocked Task or Goal is now refused, as `Enter` is in the Mindmap and the List View, with a notice naming what blocks it; nothing is written.

- **A new Flow or Habit marked Private is created Private.** The Private switch in the New Flow (`Shift+F`) and New Habit (`Shift+H`) editors was not saved, so the Flow was created public and showed with Private Mode off. It is now stored as set.

- **The subtree breadcrumb follows the window's width.** Entering a subtree while the window was narrow folded the middle of the path into `…`, and it stayed folded however wide the window then grew. The breadcrumb now folds levels away as the top bar narrows and brings them back as soon as they fit.
  In a very narrow bar it now gives up whole segments before cutting any text: `Arlesh › … › Here`, then `… › Here`, then `Arlesh › …` if *Here* alone is too long, and only then *Here* truncated beside the `…`. It no longer clips where you are off the end while leaving the root.

- **A done Habit occurrence archives once its window passes, whatever the Habit's Consumption.** Under an Accumulating Habit, a completed Task or achieved Goal occurrence used to stay Active and live forever after its day (or week, or morning) was over, as though it were unfinished work piling up. Now, once its own window has passed, it reads Lapsed with a Completed Resolution and is archived, just as a stored Task or Goal is. The iteration itself does the same once every occurrence in it is done and its window has passed. Unfinished occurrences of an Accumulating Habit still pile up as before, and a commitment Habit's supporting steps still wait on the verdict.

- **A task's virtual wait is a full Expectation: `E` opens its own editor, and everything in it is editable.** Pressing `E` on the wait an asynchronous task spawned used to open the task's editor, so the task's Plan looked as though it belonged to the wait. Now `E` opens the ordinary Expectation editor on the wait itself: title, status, Time Scope, Check every and Starting, tags, archive, privacy and the agent fields. An edit changes that one wait only. The task's Expectation template stays as it is, and every other wait it draws keeps following it. Set a field back to the template's value and the wait follows the template again. A delegated task's wait opens the same editor too; only the task being done releases it, and it takes no Check every. Neither kind of wait has a Plan or takes one from its task: in the Plan View, a check task under a wait is no longer refused because of the task's Plan.

- **Taking work out in the Plan View no longer makes it vanish.** Pressing Enter on planned work, or dropping it on the candidates pane, used to clear its Plan — and with *Show only planned to parent scope* on, it then showed in neither pane. It now moves one rung up, where the candidates side shows it: to the scope being filled when the planned pane is split by subscope, and to the parent scope when it is not. Only on a Season, which has nothing above it, is the Plan cleared.
  A Habit occurrence moves the same way, and taking one out to its Cycle Plan's own scope simply returns it to its Cycle Plan. Work whose own Time Scope cannot hold the scope above is refused with a toast, as planning is.
  A Plan View card's path line no longer flips its separators around right-to-left names: `Connections › BOND › נרי › חברים קרובים` reads left to right with every `›` the right way round, each name still written in its own direction.

- **A window of one scope reads once.** A Time Scope or Plan whose start and end are the same scope showed it twice, as "2026-09-24 morning-2026-09-24 morning". It now shows once, everywhere a window is written: the editors, the List View badges, the Steps cards and the status tooltips.

- **Marking a Flow or a flow step private now sticks.** The Private switch in the Flow editor and the flow item editor was never saved; it is now.

- **Habit occurrences in the Plan View, a week at a month's edge reads as its first month, and a selected Commitment that stays put.** A Habit's occurrences now appear like any other work: where their Habit's plan puts them, or among the candidates when nothing has planned them yet. Planning one — or taking it out of a scope — moves that occurrence alone, in the same batch as everything else; the rest of the Habit keeps its plan.

  The week at a month's edge, which Up and `M` call the earlier month's, no longer offers work planned for the later month. Only work planned to its own month is offered.

  In the List View, a selected Commitment or wait now stays on screen, dimmed, after your own edit stops it matching the filter — marking a Commitment Kept under Plan, or releasing a wait under Expectations — just as a completed task does, until you move the selection.

- **`E` on a Habit repetition says why there is no editor.** Pressing it on a commitment Habit's iteration in the List View used to do nothing at all; it now explains that a repetition is edited through its Habit's template.

- **Window titles are just the name and number, and the title bar inside a window shows them.** A
  window is titled `Arlesh` when it is the only one open, and `Arlesh [1]`, `Arlesh [2]` and so on
  while there are several. The tray menu lists windows by those same titles. The active tab is no
  longer part of the title, so the title no longer changes as you switch tabs.

  On Wayland, the title bar Arlesh draws inside each window, the one with the minimise, maximise
  and close buttons, used to read plain `Arlesh` even while the window manager's bars showed the
  window's number. It now matches the title everywhere else, and it updates when a second window
  opens or the last but one closes.

- **Path headers in the Plan View are no longer cut through.** Once a pane held more than fit, the headers naming where each run of tasks lives were squeezed shorter than their own line, clipping the text. The pane now scrolls instead, and the headers keep their full height.

- **A day's parts are no longer labelled *partial*.** Splitting a day into its bands marked Night as poking outside the day it belongs to. It does not: since the ladder moved to a 02:00 boundary a day runs 02:00 to 02:00 and contains its own Night whole. Night's calendar cell still carries the next date, for a month grid to shade, and the split was reading that as the band reaching past the day. A month's first and last weeks still straddle it and are still marked, which is what the label is for.

- **An Info note can hang under a Commitment.** `Shift+I` on a Commitment, dropping a note onto
  one, or retyping a Commitment's child to an Info was offered but failed with a database error,
  because the database had never been told a Commitment may hold notes. It now can, the same as a
  Task, and deleting the Commitment takes its notes with it.

- **"Archive & new" archives the old Habit.** Editing a Habit's schedule and choosing *Archive &
  new* made the new Habit but left the old one recurring beside it, so every occurrence arrived
  twice. The old Habit now stops recurring after today; the occurrences it already had keep their
  history. The new Habit, the archive and the edit are one step, so a single `Ctrl+Z` takes all
  three back.

- **The tray icon is called Arlesh.** Some bars headed its menu with an internal name,
  `arlesh-tray`; it now reads Arlesh there and on hover.

- **Closing a window's last tab closes the window.** Ctrl+W, the tab's ×, a middle-click or
  **Close tab** on the only tab used to do nothing. It now closes the window exactly as its close
  button does: another window stays open, and the last window hides to the tray with *Close to
  tray* on, or quits with it off.

- **Creating a child of a Tag now makes a note**, which is the only thing a Tag can hold. The
  gesture still offered a Domain, which the backend refused.

- **Dragging a tab along the strip reorders it on Linux.** The drag started and the tab faded, but
  letting go did nothing, because the Linux webview never completes a drag that carries no data.
  The drag now carries the tab, and the drop lands.

- **A Flow's target list no longer offers Habit repetitions, and its scope check works again.**
  The Target Node search in the Flow editor and the Start Flow dialog listed every Goal and Task on
  the board — including the virtual repetitions a Habit draws, which have no row a Flow could point
  at. Choosing one saved a target that did not exist, and while any Habit was drawing repetitions
  the check that narrows a scoped Flow's targets to the ones whose window can hold it failed
  outright, so every node stayed on offer. Only real nodes are listed now, and the narrowing applies
  again.

- **A paste now says which Flows it left behind.** Copying a Goal, Task, Project or Domain has
  never carried the Habits hanging inside it, and until now it said nothing about them either — the
  subtree you pasted was quietly smaller than the one you copied, with no count and no notice, so
  the only way to find out was to go looking. The paste names them now: *2 Flows under what you
  copied weren't copied with it — copy “Morning pages”, “Lift” across on their own*, in the same
  single toast as any other reason the same paste skipped something. It names rather than counts
  because a Flow under a copied node was never selected and cannot be seen in the paste, so a
  number alone would leave you hunting; past three names it counts the rest. Everything that can be
  copied still is, and cutting the same subtree says nothing, because a cut takes its Flows with it.

- **An open dropdown no longer moves the board behind it.** Arrowing through the view or status
  preset menu also walked the Mindmap's selection or the List View's rows, because the menu and the
  board listen for keys separately. A menu now holds the keyboard while it is open, the way a modal
  or an inline rename already did.

- **Apply no longer throws away the scope you already had.** Opening the Scope Picker on a task
  that was already scoped and pressing Apply without clicking a cell cleared the scope: nothing had
  been chosen, so the picker reported "no scope" rather than "no change". The picker now opens with
  that scope selected — the period it shows is the period Apply commits — so applying an untouched
  picker re-applies what was there, and a range round-trips with both its endpoints. Applying with
  nothing selected now changes nothing at all. Clearing is Clear's job, and Clear's alone. The Plan
  picker behaves the same way.

- **A Tag can hold an Info note again.** The app kept two answers to "what hangs under a Tag" and
  they disagreed: the retype menu believed a Tag holds Info notes, while every create, drag and
  paste gesture refused it everything — so `Shift+I` on a Tag was turned down, and a note could not
  be dropped on one, although the database had always allowed it. A Tag now holds Info notes, and
  only those: a label with a note about it. `Tab` on a Tag still declines — the child it would
  create is a Domain — but now says which key does work.

- **The board alone (`F11`) no longer leaves a strip along the bottom** of the List, Plan and Steps
  views. Each of them sized itself by subtracting the top bar's height from the window's, including
  when the top bar was the thing that had just been hidden.

- **A commitment under a habit occurrence that has not started no longer outlives it.** A Habit's
  later-today occurrences are hidden from every preset but **All**, together with everything hanging
  off them — but a **Commitment** attached to one stayed in the Commitments band above the list,
  describing a branch the rows below it had already dropped. The band now follows the same rule the
  task rows and the Mindmap do, so a commitment appears there exactly while the occurrence it
  belongs to is on screen.

- **Pressing `E` on an Aspect in the Steps View no longer kills every shortcut.** An Aspect has no
  editor, so the modal never appeared — but the view had already put itself into the state it holds
  while one is open, and stayed there. It now says why there is nothing to open, as the other
  refusals do. The same applies to a recurring occurrence, which is drawn from its Habit rather than
  stored.

- **Saving an editor is now one `Ctrl+Z`, and a save that fails leaves nothing behind.** A save writes several things at once — the fields, the block reasons, each tag you added or removed, each dependency, the `bd` link you dropped — and every one of them used to be its own undo step. Taking back a save meant pressing `Ctrl+Z` several times, and how many depended on which fields you had touched, so there was no way to know when you had got it all. One press now takes back the whole save, and one `Ctrl+Y` puts it back, for the Task, Goal, Commitment and Project editors alike.

  The undo notice names which it was — "Undid: edit a task" — rather than counting rows.

  A save that is refused partway is now **taken back in full** instead of leaving the fields that happened to be written first standing. The editor stays open with the reason on it, as before, and what you are looking at is the node exactly as it was — nothing half-applied, and nothing left on the redo stack waiting to reapply a save that never happened.

- **The scope picker opens on the scope you already have.** Editing a task scoped to a Wednesday
  opened the calendar on the month view, showing September when the answer was already the day. The
  picker now opens on the narrowest view that can show the scope it was handed, on the period that
  scope names: a Day scope on that day's week, a Week, Month or Season on its own period, a range at
  its endpoints' granularity starting from the earlier one. The Plan picker opens the same way. With
  nothing chosen yet, they still open where they always did — Month for a Time Scope, Day for a Plan.

- **Only one part of the day is marked as now.** In the part-of-day view every part carried the
  current-period outline, on every date. The outline now falls on the single part holding the
  current time, and only on the date that part belongs to — including past midnight, where Night
  runs to 02:00 and so still belongs to the previous date: at 00:30 it is yesterday's Night that is
  outlined, and today shows no current part at all.

- **A gesture on the Mindmap that cannot act now says so, instead of doing nothing.** Several keys
  used to fail in silence, which is indistinguishable from a broken keyboard. `Delete` on an Aspect
  did nothing at all, and an Aspect in a multi-selection was quietly dropped from the delete set
  while everything else went; `Shift+Enter` and `Ctrl+Shift+Enter` on one were equally inert. All
  three now name the reason — the Aspects are fixed, they can't be deleted, they have no new one
  alongside them and nothing above them — and a selection holding an Aspect refuses the whole
  delete rather than taking the rest, exactly as a Habit repetition already did. `Tab` on a Tag or
  on a folded run of Habit history says why nothing hangs there.

  **And every refusal the backend raises now reaches you.** A paste it rejected — a cycle, a
  constraint, a stale row — used to leave a board that had silently not changed, and a refused
  rename left the old title in place with nothing said. Paste, rename, both status controls,
  `Tab`, `Shift+Enter` and `Ctrl+Shift+Enter` all now show what failed together with the reason
  given. When a paste both skipped something and was then refused, the two are shown in one
  message rather than the second quietly replacing the first.

  **`Shift+F` on a Habit occurrence is fixed** — it opened the Flow editor on a repetition that has
  no row behind it, and saving could only fail. It is refused up front now, as `Shift+C` already
  was. The rule behind all of these is asked about the node rather than about its kind, so a folded
  run of Habit history no longer accepts dropped or pasted nodes, a drag no longer offers a target
  it cannot write to, and creating a Task under a Habit occurrence works in the List View as it
  already did on the Mindmap.

- **Unblock no longer comes back empty.** Choosing Unblock in List View while the shared status
  preset was Start showed nothing at all: Start hides a blocked task along with everything under it,
  and that rule was still being applied to the very rows Unblock asks for. Unblock now replaces the
  preset for the list instead of combining with it, so it shows what is blocking you whatever the
  Mindmap was last set to. Tags, the Info/Flow/Private toggles and every pill still apply.

- **A refused paste says which refusal it was, and why.** Every skipped node used to report the same
  "1 node couldn't be pasted here" — sending you to hunt for a better parent when the parent was
  fine, and telling you nothing about which of your nodes it meant. Each refusal now has its own
  sentence naming the thing you could actually change: a Commitment and a cross-Flow item point at
  cut, which still moves them; a Habit repetition points at the Habit's template; an Aspect says it
  cannot be moved or copied anywhere; and a node whose copy has since left the mindmap asks to be
  copied again. When the destination really is the problem the message says so in full — "1 Goal
  can't sit under Task — only under Aspect, Domain, Project, Goal." — naming what you pasted, what
  you dropped it on and where it does go. Two kinds refused by the same destination get a sentence
  each rather than a single count, a selection that hits several refusals reports all of them in one
  toast and still pastes everything that was legal, and a toast now stays up long enough to read
  what it says.

- **Habits no longer lose their iterations on startup with a "could not be loaded" banner.** Opening the app loads the board several times over at once, and each of those loads reads the whole board before writing the calendar rows a Habit's iterations sit on. SQLite lets only one connection write at a time, and it refuses — with no retry and no wait — to let a load that has already started reading become the writer while another one is. Whichever load lost that race came back with nothing, so a daily Habit could render with no iterations at all and the banner naming it stayed up. A load now claims the right to write before it starts reading, and waits its turn instead of being turned away, so every Habit derives on every start.

  The database also moves to SQLite's write-ahead log, which is what stops a load that is writing from holding up everything else that only wants to read. One visible consequence: the database is now three files rather than one — `arlesh.db` beside `arlesh.db-wal` and `arlesh.db-shm` — so a backup taken by copying `arlesh.db` alone can miss the most recent changes. Copy all three, or close the app first.

- **Pressing Delete on a Habit repetition on the Mindmap no longer opens a dialog that can only fail.** A repetition is worked out from the Habit when the board loads rather than stored as a row of its own, so there was never anything for Delete to remove — but the canvas asked you to confirm it anyway, and then reported "Delete failed" with a message about the node not being backed by a database row. The Mindmap now says what the List View already said, before any dialog appears: a Habit repetition isn't a row of its own, so there is nothing to delete — change the Habit's template or its recurrence instead. A selection holding a repetition alongside ordinary nodes is refused whole, deleting none of them, so a box-selection that happened to catch one of a Habit's occurrences can't take the rest of the selection with it; drop the occurrence from the selection and press Delete again.

- **Emptying a field now actually empties it.** Clearing a Task's or Goal's **Time Scope** or its on-exit behaviour, a Task's **Plan** or the person it is **delegated** to, a Commitment's **Time Scope** or its **Verdict Window**, a note's longer **details** text, or a Flow's **Duration**, **Phase window** or root **Cycle Plan** used to do nothing whatsoever: the box emptied on screen, the editor closed, the save reported success — and the old value was still in the database, back in the box the next time you opened the node. Nothing said so, which is what made it worth fixing rather than working around; a save that silently keeps the value you just removed is indistinguishable from one that worked until you look again. Every one of those fields now takes an explicit clear. The Flow's **Target Node** was fixed on its own when the Flow-move work needed it; it turned out to be one of a family of nineteen fields with the same hole, and the rest are closed now too. **Worth a look at your own board:** anything you thought you had cleared and later found still set was probably this — clearing it again will take this time.

- **The thing you are working on no longer vanishes the moment you change it.** Mark a task Done under **Plan** and it used to disappear on the spot — the layout closed over it, your selection was gone, and there was no way back to it except changing the filter. It read as a deletion of the thing you had just finished. Whatever is **selected** now stays on screen regardless of the filter, for as long as it stays selected: it goes **dim**, its badges say why it no longer matches — the done control, the archive box — and it holds its place until you move off it. This is not about completion alone; it covers anything your own edit does to the selected node under any filter: cycling a Task to a Goal under **Do**, marking something Private, archiving it, tagging it out of view. On the Mindmap the node's parents come along with it so it is never drawn floating on its own, and they are dimmed too if the filter was not showing them either; in the List View the row keeps its own place in the list. It ends the way you would expect — arrow or click away, press **Escape**, touch any filter, or reload, and the node goes. Arrowing away and back does not bring it back: it is gone once you leave it, and only the filter decides what you see next. Nothing about what the filters *mean* changed — it is the view holding one node open, not a filter quietly returning an extra row.

- **Escape now closes the two dialogs that were ignoring it.** Every editor dialog puts your cursor straight into its title field when it opens, so **Escape** backs out of it immediately — every one except the two that have no title field: the dialog that asks whether to convert a Goal or Task subtree into a Flow, and the one that asks for a window when you retype a node into a Commitment with nothing to inherit. Neither took focus at all, so Escape on them did nothing, and went on doing nothing until you had tabbed or clicked into the dialog first; until then the only way out was the mouse. Both now open with **Cancel** focused, so Escape backs out at once, and the convert prompt's warning that the conversion deletes your original subtree gets read before anything answers it. Focus deliberately does not land on either of the conversion switches, where a reflex keypress would have quietly flipped one instead of closing the dialog.

- **The thing you are working on no longer vanishes the moment you change it.** Mark a task Done under **Plan** and it used to disappear on the spot — the layout closed over it, your selection was gone, and there was no way back to it except changing the filter. It read as a deletion of the thing you had just finished. Whatever is **selected** now stays on screen regardless of the filter, for as long as it stays selected: it goes **dim**, its badges say why it no longer matches — the done control, the archive box — and it holds its place until you move off it. This is not about completion alone; it covers anything your own edit does to the selected node under any filter: cycling a Task to a Goal under **Do**, marking something Private, archiving it, tagging it out of view. On the Mindmap the node's parents come along with it so it is never drawn floating on its own, and they are dimmed too if the filter was not showing them either; in the List View the row keeps its own place in the list. It ends the way you would expect — arrow or click away, press **Escape**, touch any filter, or reload, and the node goes. Arrowing away and back does not bring it back: it is gone once you leave it, and only the filter decides what you see next. Nothing about what the filters *mean* changed — it is the view holding one node open, not a filter quietly returning an extra row.

- **A repeating item scoped to the morning now shows up in the morning, and goes away after it.** Give one of a Habit's items a **Cycle Scope** — "Morning", or "the second day of the week" — and nothing about the repetition respected it. The item sat there Active for the whole repetition: a morning routine read as live work all day, and a Tuesday step read as live work all week. The window was only ever applied when you *started* the flow by hand; the repetitions drew every item as if it had none.

  Each occurrence now carries its own window, and reads its state from that window rather than from the repetition around it. A **Morning** item is Active through the morning and, on a habit set to let unfinished work lapse, **Lapsed** from noon — hours before the day it sits in is over. A **Tuesday** item inside a weekly habit is live on Tuesday alone. Sub-day windows follow the **Consumption** setting like every other size: on an accumulating habit an unfinished morning piles up rather than vanishing, so if a morning routine should disappear at noon, that is what Destructive is for.

  **An occurrence whose window hasn't opened yet is hidden by Plan, Start and Do — and shown by All.** This evening's item shows up this evening under the working presets, so what's on screen is what is actually actionable now, rather than a day's worth of items all claiming to be due; anything filed underneath it waits with it and appears together, instead of being shuffled up a level in the meantime. **All still shows the whole day**, later-today items included, as All always shows everything. A hand-made task scheduled for a window still ahead is untouched by this and plans as it always has.

  **And an item with several cycles now draws several occurrences.** One item scoped to morning, noon *and* evening was drawn once and could be ticked off once — the other two were simply lost, even though starting the same flow by hand has always produced all three. It now draws one per cycle, each with its own window and **its own tick**: completing the morning one leaves the evening one to do, and the repetition counts as finished only when every occurrence is. Migration `0029` adds the per-occurrence record; an item with a single cycle keeps every completion it already had.

- **Moving a Flow now moves the Flow, instead of quietly moving one of your Domains.** Cutting and pasting a Flow, or dragging it onto a new parent, did nothing to the Flow at all — it stayed exactly where it was. What moved instead was a Domain, Project or Tag you never touched: whichever one happened to have been given the same database number as the Flow. Nothing said so, so a Flow that refused to move and a Project that reparented itself for no reason looked like two unrelated glitches. A Flow now lands under the Aspect, Domain, Project or Goal you dropped it on, in the position you dropped it, and nothing else on the board changes.

  **Its repetitions come along.** A Flow's instances appear under its **Target Node**, which is a separate setting from where the Flow itself lives — so a Flow that moved while its target stayed put left every one of its repetitions behind at the old location. Every Flow used to be handed a Target Node the moment it was created: a copy of whatever it was parented under at the time, which then stopped tracking the Flow. The Target Node is now genuinely **optional**, and leaving it empty means *"wherever the Flow lives"* rather than *"nowhere"* — a Flow with no Target Node set puts its repetitions under its own parent, so moving the Flow moves them, and there is no longer a second setting that can fall out of step with the first. A Target Node you deliberately pointed somewhere else is left exactly where you put it, on a move and ever after. The Flow editor reflects this: an unset Target Node now shows the Flow's parent as its inherited value, rather than an empty box, so you can see where the repetitions will land before you touch anything. **Removing a Target Node also takes effect now** — the × next to it used to clear the box on screen and then save nothing at all, silently leaving the old target in place, which is why a Flow could look untargeted and still put its repetitions somewhere else entirely. Migration `0025` clears the Target Node of every existing Flow that was only ever pointing at its own parent — on this board, all fifteen of them — so nothing moves and everything renders exactly where it did before.

  **Worth a look at your own board:** any Domain, Project or Tag that seems to have wandered under the wrong parent may have been moved this way, and putting it back is now safe.

- **Filtering List View by an active Project now finds your Projects instead of almost none of them.** A Project only stored a status if you explicitly set one, and the rest of the app treats a Project with no status as Active — so it showed up under Plan and Start like any other active Project. List View's **Project status** filter was the exception: it matched the stored value, and an unset Project had none to match, so filtering by Active hid it and every task beneath it. In a board where most Projects were never given an explicit status that reads as a filter that returns nothing. Migration `0023` sets the status of every unset Project to **Active** — the state it was already being treated as — and a newly created Project now starts Active rather than unset. Projects you had marked Achieved or Frozen are untouched, and Domains, Aspects and Tags keep having no status, which is correct for them. One thing this does not change: a task under a **private** Project still only appears with **Private Mode** on, however you filter.

- **Flows that hold both Goals and Tasks now materialise siblings in their true position order.** Starting a Flow whose items were a mix of Goals and Tasks could sort a Task by an unrelated Goal's position instead of its own — `flow_goals` and `flow_tasks` are numbered independently, so a Goal and a Task can share the same id, and the sibling ordering used to look a position up by id alone without checking which table it came from. Siblings now sort by their own recorded position.

- **Converting a Flow item between Goal and Task no longer makes a private item public.** The conversion carried the title, position and parent across to the new row but dropped the Private flag, so a private Flow goal became a visible task (and vice versa) the moment it was converted. Private now carries across in both directions.

- **Changing a node's type no longer throws most of the node away, and tells you before it throws away anything.** Converting between Goals, Tasks, Projects, Domains, Tags and Notes used to rebuild the node from its title, parent, position and status alone. Everything else went: its Time Scope and on-exit behaviour, its tags, its block reasons, its delegate, a Task's Plan. Worse, every Task that was *waiting on* the converted node kept a link to the node's old database id — an id SQLite hands out again to the next node you create, so weeks later a brand-new item could be silently blocked by a dependency it never had. And the conversion was not atomic: it ran as a string of separate writes, one per child, so a failure part-way could leave you with both the old node and the new one, or with the children split between them. Everything a Goal and a Task can both hold now carries across — Time Scope, on-exit behaviour, tags, block reasons, privacy, sort position — the waiting Tasks are moved onto the new node, and the whole conversion either happens or does not. Where the new type genuinely has nowhere to put something, the conversion **stops and asks first**, listing each child it cannot hold and each field it would drop, with the same Re-parent / Delete choice you already got for sub-goals. Two consequences worth knowing: converting a Task with a Plan to a Goal now always prompts, because a Goal has no Plan; and converting a Goal or Task that other Tasks depend on into a Project, Domain or Tag now says how many will stop waiting on it, and ends those links cleanly instead of leaving them pointed at nothing. **Notes are now covered by all of the above too.** Converting a note, or converting something into a note, used to run outside these protections entirely: it silently discarded the note's longer body text and its Private flag, and if the last step failed you were left with both the old node and the new one. A note's longer text now carries into a Project's or Domain's description and back again, Private carries across, and the whole conversion either happens or does not. Where a note cannot stay where it is — the new type isn't allowed to hang off the same parent — the conversion now says which item it will move out from under and where it will land, and waits for you to agree, instead of failing with a database error.

- **Convert to Flow no longer leaves a converted node's block reasons and nested notes behind in the database.** Turning a Task or Goal subtree into a Flow deletes the original subtree, but it used to delete only the nodes themselves and the notes attached directly to them: each node's block reasons, and any note nested inside another note, stayed in the database with nothing left pointing at them. They were invisible — until SQLite reused one of the freed ids for a new task, at which point a brand-new item could inherit a stranger's block reasons or notes. The conversion now removes the whole subtree, cascade included, and does it in a single transaction with the template it builds, so a failure part-way leaves neither a half-built Flow nor a half-deleted subtree.

- **A mindmap notice about something you just did (converting a node to a Flow, changing its type) no longer vanishes silently when the node isn't on screen.** These notices point at the node they're about, but if it was hidden under a collapsed branch or outside the area you'd zoomed into, the notice used to just not appear at all — the error or status message was lost with nothing shown. It now always shows, falling back to a fixed spot on screen when it can't point at the node directly.

- **Mindmap and List View keyboard shortcuts no longer go dead until you switch views.** Each view decided whether its bindings were live from a set of state flags meant to say "a modal or inline rename is open" — but a flag could stay set after the thing it described had left the screen (a delete confirmation whose target was gone from the reloaded tree, an inline rename whose node stopped rendering). Once that happened every Mindmap/List binding stayed dead, with nothing on screen left to clear the flag, until the view was unmounted by switching to the other view and back. The global **Alt+L** and **Ctrl+Shift+/** were never affected, which is what made it look like only "some" shortcuts had stopped. Modals and inline editors now register themselves while they are mounted, so what suppresses the shortcuts can no longer disagree with what is actually on screen.

- **Keyboard shortcuts no longer fire when extra modifiers are held.** A shortcut now requires exactly the modifiers it names: **Ctrl+E** or **Shift+E** no longer open the editor (bare **E** still does), **Ctrl+Shift+C/X/V** no longer cut/copy/paste, and **Shift+Tab** no longer creates a child cell, so it returns to normal focus traversal. Most visibly, **Ctrl+Shift+/** no longer also collapses the selected node while opening the cheat-sheet.

### Removed
- **The beads id.** A Task, Goal, Commitment or Project no longer carries the id of a bd issue. The
  editors' **Issue** row and its × are gone, a Steps card no longer lists an **Issue** field, a
  copied node no longer carries the link, and the MCP server no longer has the `arlesh_beads` tool
  or a `beads_id` on anything it returns. bd is retired, and work is tracked on the Arlesh board.

  Nothing is lost: every id that was set is kept in a `retired_beads_ids` table in the database.

- **The Agent delegate.** A task can no longer be delegated to the Agent, and the editor's **Delegate to agent** button is gone. Tasks that were delegated to the Agent and in progress are now **On Agent**, and their delegate is cleared. Delegating to a person is unchanged.

- **The red exclamation badge for Overdue items.** An Overdue item is marked by its amber border alone; the badge row no longer repeats it.

- **Changing a node's type.** A node now keeps the kind it was created as. `Ctrl+↑` and `Ctrl+↓`
  no longer cycle the selected node through Domain, Project, Tag, Goal, Task, Commitment and Info,
  and the node context menu's **Set type** submenu is gone, along with the prompts that came with
  them: the list of what a conversion would drop, the status-remap notice, and the "over what
  window?" question for a node becoming a Commitment. A Flow's goal and task items can no longer be
  converted into each other either. `Ctrl+↑` and `Ctrl+↓` do nothing in the Mindmap now. To make
  something of another kind, create it as that kind and move or delete the old node.

- **The path-header icons, and the switch for them.** A path header used to open with a kind glyph
  for the node its run hangs from, on by default, turned off from **Path icons** in the settings
  popover. Both are gone, in the **List View and the Plan View** alike — they draw the same header —
  so a header is now its titles, their separators and, in the List View, the `+` that creates a task
  under them. The glyph competed with the very titles it was there to qualify, and the Mindmap
  already says what kind each node is. Nothing else changes: the same icon vocabulary still marks
  Mindmap nodes and task rows, and an existing stored preference is simply ignored rather than
  migrated.

- **The Parent filter and the parent label on each row card.** Both said what the screen already said: every run of rows sits under a path header naming the branch it belongs to, so a **Parent** pill and a parent label on the card itself were restating the line directly above them. The new **Antecedent** dimension covers everything Parent could ask and more — a parent is an ancestor — so nothing has been lost. **Tag pills stay on the card**: a tag appears in no header, and clicking one there is still the only way to filter by it from a row. A saved filter still holding a Parent pill loads with it quietly dropped rather than narrowing your list with a filter no chip shows and no control can clear.

- **Hebrew is no longer a supported interface language**, and the **Language** row is gone from the settings popover — the app is English-only. If you had switched the interface to Hebrew, it now reads English. This only affects the app's own labels: **titles you type yourself still render right-to-left when you write them in Hebrew**, on mindmap nodes and in the List View, exactly as before. Status badges under a node now always sit along its left edge rather than flipping with the interface language.

## [0.3.0] — 2026-09-10

### Added
- **Mindmap: a vertical layout mode**, toggled by a new **Vertical layout** switch in the settings popover (Mindmap only) and persisted with the rest of the view state. Branches grow down and up from the root instead of right and left — the same balanced split, rotated: the first ⌈n/2⌉ of the root's children go below it, the rest above. Arrow-key navigation follows the orientation, so the branch axis (↑/↓ when vertical) always moves between parent and children and the other axis (←/→ when vertical) always moves between siblings; **Shift+←/→** likewise takes over sibling range-selection. Edges curve from the tops and bottoms of the node boxes, and drag-and-drop drop placeholders line up along the matching axis. Flipping the switch pans the canvas to keep the selected node — or the display root, with nothing selected — in view.
- **Mindmap: arrow keys pan the canvas view when no node is focused**, instead of doing nothing. With a node selected, arrows keep navigating/reordering/extending the selection as before; only the no-selection case now pans.
- **Light mode**, toggled with a new **Light mode** switch in the settings popover (next to the language toggle). Persists across reloads (defaults to dark) and applies app-wide — top bar, popovers, modals, and the Mindmap canvas/nodes all get light equivalents, via a `data-theme="light"` attribute on the document root and a matching override block in `tokens.css`.
- **Mindmap filter: an Archived tri-state pill**, tucked in a collapsible **Advanced** disclosure (Mindmap only, collapsed by default, auto-opens when engaged) in the filter popover. Cycles **Inactive → Include → Exclude** on click, overriding the status preset's handling of anything whose effective Archival is Archived (Archived-status Goals/Projects, and any scoped Task/Goal whose Resolution is Completed or Missed — the states that share the status row's archive-box badge) independently of achieved/frozen, which stay governed by the preset alone. Inactive (default) defers to the active preset; Include force-shows archived items even under Plan/Start; Exclude force-hides them even under All, hard-hiding the whole subtree so an archived item can't linger visible merely as the ancestor of an unrelated, ordinarily-visible sibling. No effect under Do. Backed by a new `archivedMode` field on the persisted `FilterState`.
- **Effective Archival**: a scoped Task/Goal whose window has fully passed is now archived regardless of whether it was ever finished — previously a resolved item (Done/Achieved) was permanently exempt, even once its window had long passed. Replaces the old single Overdue/Lapsed lifecycle with three independent derived axes: **Timing** (Pending/Active/Lapsed — window position alone, regardless of completion), **Resolution** (Completed/Missed/Overdue — only once Lapsed), and **Archival** (Live/Frozen/Archived — the effective, displayed state; Tasks are always fully derived from Resolution, Goals/Projects keep their own manually-set status, but a Completed/Missed Resolution unconditionally forces it to Archived). When that overrides a manually-set **Frozen** Goal/Project, the status-row archive badge now shows a distinct **conflict** tint and tooltip. Virtual Habit instances (and their per-item children) archive together as a unit once their iteration's window passes, rather than a completed sibling item keeping an otherwise-archived occurrence visible. **Plan** now also hides anything whose effective Archival is Archived by default (not just via the pill's explicit Exclude) — this closes the gap for a Task, or a Goal whose stored status doesn't itself say achieved/frozen/archived, that a forced Resolution archived anyway.
- **List View**: a new compact-card task list, alongside the Mindmap — switch between them with the top-bar tabs or **Alt+L**. Each task row shows its status (click to cycle To Do → In Progress → Done, or advance a Habit instance), title (click opens the editor), the same status badges as the Mindmap node, and clickable **parent**/**tag** labels that add themselves as a filter. Goals can optionally show as group headers above their tasks (off by default). List View shares the Mindmap's status preset, tag filters, and Info/Flow/Work toggles, adds its own **Unblock** preset (every blocked task), and gains seven new filter dimensions — **Parent, Dependency, Task status, Goal status, Project status, Scope state, and Blocked** — all in the same Any/All/Exclusion pill pattern as tags.
- **List View keyboard bindings**, mirroring the Mindmap's own: **Alt+F** / **Alt+A/P/S/D** for the filter menu and status presets, **↑/↓** to move the selection between rows (skipping Goal headers; from nothing selected, ↓ picks the first row and ↑ the last), **Enter** to cycle the selected row's status, **E** to open its editor, **R** for an inline rename (Enter/blur commits, Escape cancels), and **Escape** to deselect. Clicking anywhere on a card now selects it (a highlighted border) as the anchor for these bindings.
- **Redesigned filtering UI**: the status preset moved out of the popover into a compact **dropdown in the top bar** (gaining a 5th **Unblock** option while List View is active), and every active filter — tags plus, in List View, the seven new pill dimensions — now renders as a **chip in a top-bar row**, visible without opening anything. Click a chip's body to cycle Any → All → Exclude; its embedded **×** removes it. A chip's border/symbol color is a muted accent for its mode (one fixed, low-key hue per mode, shared across every dimension — blended most of the way toward the neutral border rather than shown at full strength); its background additionally tints toward the value's aspect color where one is resolvable (tags, Parent, Dependency). The Filter popover itself is now a pure "add a filter" chooser — active filters never appear inside it — organized into a few always-expanded clusters ("Tags & Type", and, in List View, "Hierarchy" and "Status & Scope") instead of one long list behind a single "Advanced" collapse. The status-preset control is a new themed `Select` component (listbox popover with keyboard nav — arrows/Enter/Escape) rather than a native `<select>`, since a native dropdown's open option list ignores the app's CSS entirely and renders with plain OS chrome.
- **Filter keyboard shortcuts**: **Alt+F** toggles the filter menu, and **Alt+A / Alt+P / Alt+S / Alt+D** jump straight to the **All / Plan / Start / Do** status presets (matched by physical key, so they work under a non-Latin layout). The filter popover's open state moved into the filter store (ephemeral, not persisted) so the shortcut and the top-bar button share it. Also: with **no node selected, Enter focuses the current display root**.
- **Status-icon row below each node**: a compact row of badges rendered under a node, each with a hover tooltip (SVG `<title>`), aligned to the UI's leading edge (left in English, right in Hebrew). Badges: **Scope** (clock; tooltip shows the resolved window — crossed out once the window has passed), **Overdue** (red exclamation, for a kept-past-window item), **Archived** (box; for an archived goal/project or a lapsed scoped item), **Planned** (calendar; tooltip shows the Plan window), **Frozen** (snowflake; frozen goal/project), **Details** (ellipsis; an Info node with a Details description — tooltip shows it), **Flow/Habit instance** (the flow wave for a real Start-flow instance, the cyclical habit glyph for a virtual Habit iteration), and **Tags** (tag icon; tooltip lists the tag names). Backed by a pure `deriveStatusIndicators` mapper (unit-tested) and a new `list_flow_instance_nodes` command that surfaces which real Goal/Task nodes were materialized by a started flow.

- **More Mindmap keyboard bindings**: **C** centers the view on the selected node, **F** converts the selected node to a Flow (on nodes where that's valid — same eligibility as the context menu's "Convert to Flow"), and **Shift+↑/↓** extends or shrinks the selection across siblings, mirroring shift-click's range selection.

### Changed
- **Copy no longer moves.** `Ctrl+C` then `Ctrl+V` in the Mindmap used to relocate the original node — copy and cut were the same gesture, and the non-destructive one was the one that looked like it lost your work. A paste of a **copy** now leaves the original exactly where it was and builds a real, independent duplicate of the whole subtree under the target: same title, status, tags, notes, Time Scope, on-exit behaviour, Plan, delegate, block reasons, privacy, issue link, Backlog and dependencies (which still wait on the same things the original waits on). Editing one side never changes the other. Multi-select copies, the copy lands at the end of the target's children, the clipboard survives so you can paste the same subtree into several places, and the whole copy either happens or none of it does. **Cut is unchanged** — it still moves the originals and clears the clipboard. Aspects, Flows, flow items and Habit occurrences can't be copied; a paste that includes one pastes the rest and says how many it skipped.
- **List View cards now span the full row** (previously capped at 720px) and get more breathing room (larger padding, wider row gaps). Each card is also tinted with its aspect's colour, using the same fill/opacity derivation the Mindmap node uses, so a task's card matches its node's colour there.
- **List View: double-clicking anywhere on a task's card opens its editor**, in addition to the existing single click on the title — matching the Mindmap's own double-click-to-edit gesture.
- **A Frozen or Archived Project now hides its whole subtree in Plan and Start**, instead of staying on screen as the ancestor of unresolved work inside it — its status says the work is off the table, so nothing beneath it is plannable or startable either. Gates the subtree the same way a blocked Task/Goal already does under Start, on both the Mindmap and in List View. **Achieved** is deliberately left softer and keeps the ordinary ancestor-keeping, since finished work can still hold unfinished items worth surfacing; the **Archived** pill's *Include* still overrides the hiding for the Archived case.

### Fixed
- **Setting a flow item's Cycle Scope (e.g. scoping a Habit item like Breakfast to a Part of Day) now actually works.** The picker required selecting a cell *and then* pressing a separate "Add cycle" button — an undiscoverable two-step flow; a user could select a cell, never notice the confirm step was needed, and save with nothing persisted. Cycles now render as a simple **list of rows** by default (visible immediately when any exist); an "Add cycle" trigger or a row's edit action opens a **drill-down picker** (mirroring the app's own `ScopePicker`) that navigates the flow window's nested periods one level at a time — clicking a cell at the chosen granularity toggles that occurrence on/off immediately, no separate confirm step. This also handles a flow spanning multiple periods of its own kind (e.g. a 2-week flow) by browsing which period first ("Week 2 › Tuesday › Morning") instead of one flat, unlabelled cell grid. Part of Day cells and Plan ranges now show their real band names (Morning, Noon, Afternoon, Evening, Night, Premorning) instead of generic "Part 1..6".
- **Double-clicking a virtual Habit instance (a daily/weekly/etc. occurrence, or one of its items) no longer opens a Task/Goal editor that fails to save.** These nodes aren't backed by a real row — `onTaskSave`/`onGoalSave` parsed a `dbId` from their non-numeric `-virtual` id tail, got `NaN`, and the save (e.g. picking a Part of Day Time Scope) silently failed. A virtual instance's Time Scope is derived from its flow's Duration kind plus the item's Cycle Scope — set on the flow item's **template** node (its "Cycles" field) instead. The instance itself now stays read-only on double-click, as intended; only its status-cycle click still works.
- **Pasting a copied/cut Aspect node in the Mindmap no longer throws an unhandled `aspects are fixed and cannot be modified` error.** `onPaste` sent every clipboard node straight to `moveNode` regardless of kind, unlike delete/insert-parent/create-sibling which already skip Aspects; it now filters clipboard nodes through the same `isValidDropTarget` rule drag-and-drop uses. Anything a paste can't place — an Aspect, a Habit occurrence, or, for a copy, a Flow or flow item — is skipped with a toast saying how many, instead of being dropped without a word.
- **A Habit's Recurrence start/end now pick a scope of the flow's own Duration kind** (e.g. Week 28 for a week-scoped Habit) instead of an arbitrary date that was silently snapped to one — the editor's Recurrence fields are now a calendar picker locked to that kind (`AnchorScopeField`, a `ScopePicker` variant), not a raw `<input type="date">`. Virtual Habit instance titles likewise now read `{flow title} {start scope}` (e.g. "Exercise W22", per SPEC) instead of the raw ISO date, falling back to the date only for a sub-day (Phase) window.
- **List View's Work filter no longer misses NSFW subtrees.** The Mindmap hides an NSFW node's whole subtree via tree pruning (a hard-hidden ancestor cuts off recursion into its children); List View instead filters a flat, pre-flattened array of task rows, so a task nested under an NSFW-marked Project/Goal/Domain — without being marked NSFW itself — kept showing under Work mode. Each row now also carries `hasNsfwAncestor`, checked alongside its own `nsfw` flag.
- **Start filter no longer shows blocked items.** A blocked task/goal was correctly excluded from matching on its own, but `filterTree` still kept it when it had a startable descendant (ancestors of matches are retained to keep the tree connected), so blocked nodes leaked into Start. A blocked task/goal now hard-hides its whole subtree in Start mode — it gates what's beneath it, so nothing under it is "startable now" either.
- **Setting a Project's status to Achieved or Frozen now works.** The Project editor offered **Paused** and **Completed** pills — a vocabulary the backend never had: `update_domain` rejected them outright (``unknown variant `completed`, expected one of `active`, `achieved`, `frozen`, `archived` ``), so *no* status change other than Active/Archived could be saved. The editor now offers the Active / Achieved / Frozen / Archived set that SPEC, the `domains.status` CHECK constraint, and Rust's `ProjectStatus` all agree on. The List View's **Project status** filter pills were wrong for the same reason (`paused`/`completed` could never match a stored row) and are fixed too; every status vocabulary in the frontend now derives from one shared source rather than being re-listed per call site.
- **An Achieved or Archived Project no longer lingers in Plan because of the Domains inside it.** Only a Project can be given a status, so an Aspect/Domain is always status-less — and Plan's "an active container shows on its own, so you can plan into an empty one" rule read every one of them as active, keeping the resolved Project above them visible as their ancestor. A status-less container now **inherits the nearest status-bearing ancestor's** status (transitively, through intervening status-less Domains): the Domains under an Achieved/Archived Project are resolved along with it, while those under an Active one still show on their own. A container with no status-bearing ancestor at all still reads as Active. Ancestor-keeping is untouched — a resolved Project holding genuinely unfinished work stays visible, as before.
- **List View's Plan preset now hides effectively-archived tasks**, matching the Mindmap. The Effective Archival work taught the canvas's Plan branch to hide any scoped task whose window lapsed (`archived`), but List View's parallel preset predicate was never updated alongside it, so archived tasks kept showing as rows. Its Plan and Start branches now also honour the **Archived** pill's *Include*, as the Mindmap already did. Both surfaces now share one archived predicate instead of each keeping its own copy.

## [0.2.0] — 2026-07-04

### Added
- **NSFW nodes + Work filter**: every node kind (Domain/Project/Tag, Goal, Task, Info, Flow, and flow-template items) can be marked **NSFW** from a new **Advanced** section in its editor modal — collapsible, shared across all editors. Marking a **flow item** NSFW is a real stored field that also propagates to that item's instances: the virtual Habit instances inherit it, and starting a flow copies it onto the materialized Goal/Task (the flow root's flag propagates to the root instance likewise). A new **Work** toggle under the filter's **Advanced** section hard-hides every NSFW node together with its whole subtree when on; it persists across reloads and lights the top-bar filter badge. Migration `0021` adds a `nsfw` column to `domains`, `goals`, `tasks`, `infos`, `flows`, `flow_goals`, and `flow_tasks`. All the boolean toggles in the filter and editor modals are now rendered as sliding **switches**.

### Changed
- **Block reasons are now an ordered list** (previously a single string), on **both tasks and goals**. A task/goal is blocked (red stop-sign) when it has **any** reason — one of its explicit reasons, or a **virtual** one derived from an unmet dependency (a non-Done task / non-Achieved goal), now surfaced on the canvas. Explicit reasons live in a normalized `block_reasons` table (migration `0020`, replacing the `tasks/goals.blocked_reason` columns); cross-table type conversion copies them to the new node. The task/goal editor gains an add/remove **Block reasons** list.
- **Tag picker is a search combobox**: the task/goal editor's tag checkboxes are replaced by a search-dropdown — chosen tags show as removable **pills**, and the options are **grouped by parent domain** (with each tag's colour).
- **Context menu "Set type" submenu**: the node context menu's two "Type →"/"Type ←" cycle entries are replaced by a single **Set type** entry that opens a submenu of the node's valid target kinds — pick a type directly instead of stepping through the cycle. The submenu (and the Ctrl+Up/Down cycle) only offer kinds the hierarchy allows for the **parent**: a **Project** is offered only under an Aspect/Project parent, and a **Tag** not under a Tag. The submenu additionally hides kinds that couldn't hold the node's existing **children** (e.g. no Task/Info option for a node with goal children). (Ctrl+Up/Down still cycles.)
- **Enter toggles a goal's achieved status** (in addition to cycling a task's status) — matching the icon click, so a selected goal can be marked achieved from the keyboard.
- **Goals now render as the MDL2 Bullseye** — a plain target while open, and a target **struck by an arrow** (in a brighter shade than the rings, so it's easy to spot) once achieved — so a goal's completion is visible at a glance on the canvas (the rings are identical between states; achieving just drops the arrow in). Since virtual Habit **goal instances** have no editor, clicking their icon marks them **achieved** directly (goal instances read `achieved`/`active`, like a real goal). Virtual Habit **task instances** now cycle the full **todo → in_progress → done** on click (not just todo↔done); an instance's status is stored as a per-iteration Modification, so `in_progress` is surfaced but doesn't resolve the iteration.
- **Habit flows** (a flow with a Recurrence) now render with a **cyclical-arrows** icon instead of the plain-flow wave, so a habit is distinguishable at a glance on the canvas. The `Flow` model gains a derived `is_habit` flag (computed from `flow_recurrences`, never stored)
- A task's **Plan** is now a boundaries window (start + end scope), like its Time Scope, so a task can be planned across a span (e.g. W45–W49), not just a single scope; migration `0007` moves `plan_scope_id` to `plan_start_id`/`plan_end_id`. The Plan field is now a range picker rendered like the Time Scope
- Split a task/goal's single `scope_id` into a **Time Scope** (relevance window, on tasks and goals) and a task-only **Plan** (scope scheduled into). Time Scope is a boundaries window (start/end scope ids) that also remembers its Duration parameters when set that way; migration `0006` migrates the old `scope_id` to the Time Scope and adds `plan_scope_id`. API types gain a shared `TimeScope` value object

### Added
- **Canvas follows the focus**: navigating (arrow keys) to a node off the visible canvas now pans to bring it into view; and if a filter leaves nothing on screen, the canvas recenters on the root. Added **Ctrl+= / Ctrl+-** (and numpad +/−) to zoom the canvas from the keyboard.
- **Mindmap filter** (top-bar funnel button): prunes the canvas to a **status preset** — **All** / **Plan** (hide done/achieved/frozen/archived) / **Start** (Plan minus in-progress-with-no-todo-child, blocked, scope-lapsed, and Habit flow nodes) / **Do** (only in-progress tasks) — plus **tag filters** in Any/All/Exclude modes, and **Info/Flow** type-visibility toggles. Non-matching nodes are hidden but ancestors of matches stay (the tree stays connected). Flows have both a global type toggle and a per-mode "include flows" subtoggle. State persists across reloads; the button shows an active badge. Backed by a pure `filterTree` prune + a persisted `useFilterStore`.
- **Redesigned top bar**: the "Arlesh" label becomes a **settings gear** (popover with the Hebrew/English toggle), the subtree **back-nav** moves up into the bar (shown only inside a subtree), and the Filter button sits at the end.
- **Node search (Ctrl+O)**: a floating search palette that filters all nodes by title; selecting one **enters it as the display subtree** (like double-Enter). Results appear only once you type, are sorted by kind (Aspect → Project → Domain → Flow → Goal → Task → Info), and same-titled entries are disambiguated by their **parent path** in faded parentheses (extended outward until unique). Arrow keys move the selection, Enter opens, Escape closes.
- **Info edit modal**: info nodes now open a proper editor (double-click) with their one-line **body** plus a separate multi-line **Details** field, for longer supporting text such as error tracebacks. Migration `0019` adds a nullable `details` column to `infos`.
- **Plannable flow root**: a Flow whose Instance Type is **task** can now carry a **root Cycle Plan** — a relative plan window inside the flow window (e.g. "days 2–3 of the window"), set in the flow editor with the same relative picker flow items use. On start it resolves into the root Task's Plan; a Habit's root instance inherits it. Goal-instance flows have no plan (Plan is task-only). Migration `0018` adds `root_plan_kind/start/end` to `flows`.
- **Convert a Task/Goal into a Flow**: a new **Convert to flow** context-menu action (shown on goals/tasks that sit under an Aspect/Domain/Project/Goal — never under a task, where a flow can't live) turns an existing subtree into a Flow template of the same instance type. A prompt confirms the destructive change with toggles for **Keep dependencies** and **Map scopes** (both on by default): the root's Time Scope becomes the flow Window and each descendant's scope a relative cycle scope; intra-subtree task dependencies become flow dependencies; the original subtree is deleted. Backed by the `convert_to_flow` command.
- **Edit-habit reconciliation (Phase 8.5)**: changing a habit's window or repetition (start/gap/end) while it has completed iterations now prompts before saving — **Archive & new** deep-clones the flow's template (items, cycles, dependencies remapped) into a brand-new habit that carries the edited schedule, leaving the original habit and its completion history untouched; **Discard & regenerate** clears the completions and applies the edit in place; **Cancel** aborts. Consumption-only edits (which don't move iteration scopes) save silently. Backed by the `fork_flow`, `clear_habit_modifications`, and `habit_completion_count` commands.
- **Per-instance Habit iterations (Phase 8.4)**: each iteration now materializes like a started flow — a **root** instance plus the flow's **items** as its descendants (mirroring the template hierarchy) — all virtual and **each individually completable**. Clicking any one (the root included) writes/clears a `done` **Modification** for just that instance; the iteration reads as **Done** only once the root *and* every item are done. The root is a first-class instance (a `flow_root` Modification keyed to the flow), not a derived aggregate — so an **item-less habit** (e.g. a weekly "shave") is completed by ticking its root. Instances inherit the aspect colour and dim when their iteration has lapsed and they're still open. Backed by the `list_habit_item_completions` and `set_habit_item_done` commands (migration `0017`). (Per-instance field edits and dependency remaps remain for a follow-up.)
- **Habit instance display (Phase 8.3)**: a Habit's derived iterations now render in the mindmap as **virtual**, read-only child nodes under the flow's target (titled `{flow title} {date}`), classified by the backend — Done iterations show the done glyph; Lapsed/Missed ones are dimmed. They carry no DB row, so they are non-interactive (no edit/drag/status/context) and can't be mutated. (The future-iteration ellipsis node and display-pinning are still to come; completing an instance — Phase 8.4 — lands next.)
- **Recurrence editor — create a Habit (Phase 8 UI)**: the flow editor now has a **Recurrence** section (for a scoped, saved flow) that turns it into a **Habit**. Tick "Repeating" to set a **Start** day, an optional **Gap** (N of day/week/month/season), an optional **end**, and the full **Consumption** tree — Destructive vs Accumulating, then Overlapping vs Blocking, then the catch-up policy (all-pending / next / latest) — with the sub-choices revealed progressively. Start/end dates materialize to scope ids on save; the recurrence loads back from `flow_recurrences` when you reopen the editor. Backed by the existing `set`/`get`/`delete_flow_recurrence` commands.
- **On-exit behavior for scoped items (Feature A)**: giving a Task or Goal an explicit Time Scope now also sets an **on-exit** choice — **Keep** (the item stays, flagged **Overdue**, once its window passes unfinished) or **Archive** (it **Lapses**, dropping from the active view). Both states are **derived** on read from the effective window + status + now (local wall-clock) — never stored, auto-reversing if the scope is widened — and a resolved item is exempt. Inherited-scope items inherit the ancestor's behavior. This unifies with the Habit **Consumption** root (Archive = Destructive, Keep = Accumulating). A toggle appears beside the Time Scope field in the Task/Goal editors, and overdue nodes get an amber border while lapsed nodes are dimmed on the canvas; migration `0015` adds `on_scope_exit`; backed by the `derive_scope_lifecycles` command.
- **Sub-day Flow Windows / Habits (Feature B)**: a Flow Window can now be a sub-day **Phase** — a part-of-day band (e.g. Evening) or an exact `HH:MM–HH:MM` range — alongside the coarse **Span** (N of day/week/month/season). A Phase is carried date-free on the template and combined with the anchor's date on start (migration `0016`). A **Habit** with a Phase window recurs at the fixed time-of-day, stepping whole days by its Gap ("10:00–12:00 daily", "Evening every 2 days"). Iteration windows are now half-open datetimes and generation takes a local wall-clock `now`. The flow editor's window picker now offers **part** (a band select) and **exact** (a start/end time range) alongside the coarse kinds.
- **Virtual Habit-instance generation (Phase 8.2)**: a Habit's iterations are now **derived** on demand from its Recurrence, the current day, and which iterations have been completed — nothing is stored per iteration. Each started iteration is classified **Active / Done / Lapsed / Missed** per the Consumption behavior: Destructive lapses passed-unfinished iterations and keeps only the current one active; Overlapping keeps every started iteration active until done; Blocking withholds beyond the open iteration and, on completion, advances by *next*, *latest* (skipped → missed), or *all-pending* (backlog released). Only started iterations are generated (the future is the ellipsis). Migration `0014` adds a `resolved_at` completion time (so Blocking catch-up jumps are reproducible). Backed by the pure `flows::habits` classifier and the `generate_habit_iterations` command
- **Recurrence / Habit model (Phase 8.1)**: a scoped flow can now be turned into a **Habit** by giving it a **Recurrence** — a Repetition (Start anchor, optional Gap whose kind is no finer than the habit scope, optional end) plus a **Consumption** config tree (Destructive/Accumulating → Overlapping/Blocking → catch-up all-pending/next/latest). The recurrence lives in a `flow_recurrences` row keyed by the flow (presence marks the flow as a habit; deleting it demotes back to a plain flow), and virtual-instance divergences will be stored as **Modification** rows keyed by (flow item, iteration scope) with per-iteration dependency edges (migration `0013`). Backed by `set_flow_recurrence`/`get_flow_recurrence`/`delete_flow_recurrence` commands; instance generation and display land in later Phase 8 steps
- **Flow target containment (Phase 7.5)**: the flow target picker now offers only **scope-valid** targets. When starting a scoped flow, targets whose Time Scope can't contain the concrete window (anchor + duration) are hidden, and a pre-filled target that falls out of range shows an inline warning that blocks the start; in the flow editor, before an anchor is known, a coarse filter hides targets too small to ever hold the flow window. When narrowing a scope orphans descendants that came from a flow, the existing clamp-or-cancel prompt now annotates them with their **"from flow X"** origin. Backed by the `scope_valid_flow_targets` and `flow_origins` commands
- **Start a flow (Phase 7.4)**: press `s` on a focused flow node (or context-menu **Start flow**) to materialise the template into a **real, independent Goal/Task subtree** under a target. The start modal takes a root title, a target node (defaulting to the flow's Target Node), and — for a scoped flow — an anchor date whose flow-kind scope becomes the window's first period. Each relative cycle pair resolves **by offset** into a concrete Time Scope + Plan (an item with N pairs yields N items; an unscoped flow yields one unscoped item each), intra-flow dependencies remap by **fan-in** (each dependent instance waits on every blocker instance), and the run is recorded in `flow_instances` / `flow_instance_nodes` (migration `0010`) so flow-originated nodes stay distinguishable and moves are detectable. Backed by the `start_flow` command.
- **Flow items + cycles (Phase 7.3)**: a flow now holds child **flow items** (flow-goals / flow-tasks) rendered under it in the mindmap, created like any child (a flow root spawns items of its Instance Type; an item spawns items of its own kind). A dedicated **flow-item editor** sets the item's title, block reason, intra-flow **dependencies** (on any other item in the same flow), and relative **(Cycle Scope, Cycle Plan)** pairs via a grid modelled on the Scope Picker but labelled relatively ("Day 3 of the flow window"). Cycles and dependencies are stored as relative indices (migration `0009`: `flow_item_cycles`, `flow_dependencies`) and resolved to concrete scopes only at start (Phase 7.4). Backed by `list_all_flow_goals`/`_tasks`/`_cycles`/`_dependencies`, `update_flow_goal`/`_task`, `delete_flow_item`, `set_flow_item_cycles`, and `add`/`remove_flow_dependency` commands
- **Flows (Phase 7)**: a Flow is a template node kind that materializes a Goal/Task subtree on demand. Create one via the **New Flow** context-menu action on an Aspect, Domain, Project, or Goal — this opens a blank **Flow editor** and the flow is persisted only on save. The editor covers its title, **Instance Type** (goal or task), an **optional** Duration-form **flow scope** (N of day/week/month/season, or unticked for Unscoped instances), and a **Target Node** search combobox. Flow nodes render with a wave icon. Backed by the `flows`/`flow_goals`/`flow_tasks` tables (migration `0008`) and `create_flow`/`get_flow`/`list_flows`/`update_flow`/`delete_flow` commands. Flow items, cycle scopes, and start-materialization land in later Phase 7 steps
- Scope summary text is now localized: `Unscoped`/`Unplanned`, durations (pluralized), and month/season/week labels go through i18next (new `scopes` namespace) with Hebrew translations, so the translation-completeness gate covers them
- Narrowing a Task/Goal's Time Scope in the editor, or **dragging a scoped item under a tighter-scoped ancestor**, now detects the items that would fall outside the resulting window and **prompts to clamp them to the new scope or cancel** (via `scope_containment_conflicts` / `reparent_scope_conflicts`), instead of a hard backend rejection
- **Scope Picker**: a date-picker-style calendar (season/month/week/day/part-of-day) wired into the Task and Goal editor modals. Set a **Time Scope** as a Boundaries range or a **Duration** (N of a kind, snapshotted while remembering the duration form), and a task **Plan** via a single-scope picker constrained to the task's Time Scope. Out-of-window Plans/child scopes are rejected by the backend and surfaced as the modal's save error. (Exact-datetime clock view and the narrowing cascade prompt are still to come.)
- Scope command surface for the Scope Picker: `get_or_create_part_scope`, `get_or_create_exact_scope`, and `resolve_scope` (returns the half-open `[start, end)` datetime window + current `active` state, reusing `scopes::resolve`); frontend `src/api/scopes.ts` wraps these plus the existing `get_scope`/`get_or_create_scope`
- Write-time scope-containment enforcement: a task's **Plan** must be within its **Time Scope**, and a task/goal's **Time Scope** (and a task's Plan) must be within the nearest scoped ancestor's window — interval containment on resolved datetimes. Violating creates, updates, and reparents are rejected with `TaskError::ScopeContainment`
- `scope_containment_conflicts` command (and `scopeContainmentConflicts` API): lists the task/goal descendants a scope-narrowing or reparent would orphan, to drive a clamp-or-cancel prompt (the prompt UI lands with the Scope Picker)
- Part-of-Day and Exact scope kinds (Phase 6, Time Scopes): six sub-day bands (Night crosses midnight, parented to its starting day) and arbitrary minute-precision datetime ranges. Scopes resolve to half-open `[start, end)` datetime intervals with `active` and interval-containment checks; `ScopeRepository::get_or_create_part` / `get_or_create_exact` constructors; migration `0005` rebuilds the scopes table with `part`/`day_id`/`start_datetime`/`end_datetime` columns and per-family partial unique indexes
- Direct integration tests for `database::connect()` and `database::run_migrations()` — verifies the `after_connect` PRAGMA hook and migration seed; `database/mod.rs` is now 14/14 (100%)
- Rust integration tests expanded from 22 to 74: covers all repository branches including blocked_reason set/clear on tasks and goals, `TaskStatus::InProgress`, `GoalStatus::Frozen`/`Archived`, `GoalRepository::is_achieved`, scope assignment on tasks and goals, cannot-update/cannot-retype-to-aspect, project-without-parent, linked_note update on persons, December month scope, Aspect subtype listing, Project/Tag subtype conversion, `ProjectStatus::Achieved`/`Archived`; `domains/mod.rs` is now 109/109 (100%)
- Stop hook now runs `cargo tarpaulin --engine ptrace --skip-clean` (cache at `~/.cache/arlesh/tarpaulin`) and blocks the session if coverage drops below 85%; tarpaulin uses a separate target dir to avoid invalidating `cargo test` artifacts
- 34 Rust inline unit tests (`#[cfg(test)]`) covering pure functions with no DB dependency: `scope_bounds` (all 4 kinds including leap-year Feb and Dec month), `scope_label`, `week_number`, `season_name_and_year`, `season_start_month_and_year` (scopes/mod.rs); `ScopeKind::as_str`, `ScopeId` roundtrip (scopes/model.rs); `TaskStatus::as_str`, `GoalStatus::as_str`, `TaskId`/`GoalId` roundtrips (tasks/model.rs); `dependency_parts` task/goal branches (tasks/mod.rs)
- 28 frontend unit tests: Zustand store (use-mindmap-store.test.ts — selectNode, addToSelection, setSelection, enterSubtree, exitSubtree, exitToRoot, toggleCollapsed, clipboard, toast); context-action dispatch (use-context-action.test.ts — all 10 CONTEXT_ACTION variants including null-clipboard PASTE guard and unknown-node guard)

### Removed
- `TaskStatus::parse_db()` — dead code, never called anywhere in production or tests
- Dead `end_month == 12` branch in `scope_bounds` for Season — `end_month` is always 2, 5, 8, or 11 by construction; also removed the unused `end_month_start` intermediate variable

### Fixed
- **Holding Ctrl+Up/Down no longer duplicates a node**: the type-cycle now ignores key auto-repeat. A held key fired repeated cross-table retypes faster than the tree reloaded, racing each conversion's create+delete and leaving duplicate siblings.
- Deleting a Goal or Task now **cascades** its whole subtree (descendant tasks/goals and their infos) instead of leaving orphans — the polymorphic parent link has no foreign key, so type-conversion and other internal deletes previously stranded children (the source of the `goal N not found` orphans). The delete confirmation already warns with the descendant count when a subtree would be removed
- The mindmap failed to render (`goal N not found`) whenever an orphaned Task/Goal existed — one whose parent points to a since-deleted item. The per-load scope-lifecycle derivation walks each item's ancestor chain, and a dangling link made the whole `derive_scope_lifecycles` command error, rejecting the load. The ancestor walk now treats a missing ancestor as a broken chain (the item is Unscoped above it) instead of propagating a not-found error
- Info nodes rendered with a task icon (cycle appeared to do nothing); added a dedicated InfoIcon (circle with an "i") and wired it into NodeIcon

### Added
- Double-tap Enter on a focused node enters it as a subtree (same as context menu → Enter; only applies to nodes that can be subtree roots: not tasks, goals, or tags)
- Canvas recenters on the new root node when entering a subtree

### Fixed
- After deleting a node, focus now moves to the nearest non-deleted ancestor instead of clearing to nothing; for multi-delete, focus targets the parent of the first deleted node
- Left/Right arrow keys now navigate to parent or children only (whichever lies in that screen direction), never jumping across to unrelated siblings; Up/Down navigate among siblings only

### Added
- Info node kind: free-text bullet-point nodes (ℹ icon) that can be children of any existing node type and can only have info children; stored in a new `infos` DB table
- Info nodes participate in the type cycle (Ctrl+Up/Down); cycling to info when a node has non-info children shows a warning modal with reparent/delete options
- Multi-node selection: Ctrl+click toggles a node in/out of the selection; Shift+click on a sibling range-selects all siblings between anchor and target; Shift+click on an ancestor selects the anchor and all nodes up to that ancestor; Shift+click on an unrelated node does nothing
- Ctrl+X / Ctrl+C now operate on all selected nodes; Delete key deletes all selected nodes
- Paste of a multi-node clipboard moves top-level selected nodes (ancestors take their descendants with them) as children of the paste target in original tree order
- Delete confirmation for multiple nodes shows "Delete N nodes?" instead of a single title
- Shift+Enter on a focused node creates a new sibling of the same type and enters inline edit mode
- `e` key on a focused node opens the editor modal (same as double-click)
- `r` key on a focused node starts inline title editing (same as F2)
- Ctrl+Enter on a focused node inserts an intermediate parent between the node and its current parent, then enters inline edit mode on the new parent
- Enter key cycles status on focused task nodes (todo → in_progress → done → todo); blocked tasks are skipped

### Fixed
- Node also resizes during inline editing when typed text wraps to a new line (previously only explicit Shift+Enter triggered a resize); uses the same character-width heuristic as display mode via a new `estimateWrappedLineCount` helper
- Node text overflowed its bounding box when the title wrapped across multiple lines: `NodeLabel` was centering using only the explicit-newline count instead of the estimated wrapped-line count, producing excess `paddingTop` that pushed wrapped text outside the `foreignObject`; `computeNodeDimensions` now returns `lineCount` and `NodeLabel` uses it directly

### Fixed
- SubtreeNavPill no longer overlaps the top bar: pill container now uses `top: calc(var(--topbar-height) + var(--space-2))` via a new `--topbar-height` token (36 px)
- Plain Esc no longer exits the subtree when a node is selected; it now only deselects the focused node
- Shift+Esc was incorrectly wired to exit-to-root; it now correctly exits one level to the parent subtree

### Added
- SubtreeNavPill shows two buttons: "← Arlesh" (exit to root) and "← {parent name}" (exit to parent)
- Ctrl+Esc exits to the Arlesh root from anywhere in subtree mode (works even with a node selected)
- Shift+Esc exits one level to the parent subtree (works even with a node selected)
- Plain Esc deselects the focused node; has no subtree-exit effect

### Fixed
- Node rect and textarea now expand in real time as the user presses Shift+Enter during inline edit, preventing content overflow; text position is identical between display and edit modes (consistent `paddingTop` centering instead of flexbox in display vs top-align in textarea)
- Moved `CONTEXT_ACTION`/`ContextMenuAction` to `context-action.ts` and `WARNING_VARIANT`/`WarningAction` to `warning-confirm.ts` so their component files export only the default component (fixes `react-refresh/only-export-components` ESLint warnings)

### Changed
- Aspects renamed from color labels to meaningful names: Red → Body, Purple → Connections, Green → Growth, Blue → Duty, Gray → Flow, Steel → Self
- Node height now expands dynamically to fit the full title without truncation; text wraps within the fixed node width using the browser's word-wrap
- Inline node edit uses a `<textarea>` instead of `<input>`; Shift+Enter inserts a line break, Enter commits
- Vertical sibling spacing increased from 60 px to 90 px to accommodate multi-line nodes
- Arrow key navigation now moves only to connected nodes (parent, children, siblings) while still picking the visually nearest one in the pressed direction — prevents jumping across unrelated branches; the Arlesh root node is included so navigation can pass from one side of the tree to the other through the centre
- After deleting a node, focus moves to its parent (or clears if the parent is the virtual root)

### Added
- Delete confirmation modal: replaces the browser `confirm()` dialog with a native in-app modal that shows the node title and total descendant count (e.g. "This will also permanently delete 3 descendant nodes"); Cancel is auto-focused so accidental Enter presses don't delete

### Fixed
- Cascade-delete subtrees: `removeNode` now receives a post-ordered list of all descendants (children before parent) and deletes them sequentially, preventing the SQLite FOREIGN KEY constraint failure (code 787) that occurred when deleting a domain/project with children
- Delete errors are now surfaced inside the confirmation modal instead of being swallowed silently (`void removeNode().then()` without `.catch()`)
- Keyboard shortcuts are blocked while the delete modal is open (Delete key no longer double-fires)
- White border around the app window: added `margin: 0; padding: 0` reset for `html`, `body`, and `#root` in `tokens.css`; deleted unused Tauri scaffold `App.css` (which also set a light background on `:root`)
- SVG canvas and drag ghost now set `direction: ltr` explicitly, preventing CSS `direction: rtl` (inherited from the document root in Hebrew mode) from flipping `textAnchor` semantics and causing LTR node text to overlap the icon
- SVG node layout now mirrors per-node based on the node's text content (first strong directional character), not the global app language — Latin-titled nodes always render LTR and Hebrew-titled nodes always render RTL, regardless of the language toggle; inline edit uses `dir="auto"` so the browser follows what the user types; `DragGhost` applies the same content-based detection

### Added
- Hebrew (עברית) i18n support with full RTL layout: all user-facing strings extracted to namespaced JSON translation files (`src/i18n/locales/{en,he}/{namespace}.json`); language toggle in new top bar persists to `localStorage`; `dir` attribute on root element drives RTL cascade throughout the app including CSS modules updated to use logical properties (`inset-inline-start`, `margin-inline-start`, `padding-inline-start`, `text-align: start`)
- `TopBar` component: slim header with app name and language toggle (עברית / English)
- `CONTEXT.md`: domain glossary with canonical term definitions and Hebrew translations
- `docs/TRANSLATIONS.md`: full terminology translation table and guide for adding languages
- ESLint `i18next/no-literal-string` rule enforcing that all JSX text and key attributes are wrapped in `t()`; Stop hook in `.claude/settings.json` runs lint automatically after each session

### Changed
- Refactored `src/components/` from flat files to per-component subdirectories; each component's TSX and CSS module are co-located in their own folder
- Extracted drag state and mouse event handlers into `src/hooks/use-drag.ts`
- Extracted keyboard navigation handlers into `src/hooks/use-keyboard-mindmap.ts`
- Extracted tree utility functions (`findNode`, `findParent`, `nearestInDirection`, `gatherSubtreeItems`, `collectTasksAndGoals`) into `src/utils/mindmap-tree.ts`
- Extracted shared node visual computation (`computeNodeAppearance`) into `src/utils/node-visuals.ts` to eliminate duplication between `MindmapNode` and `DragGhost`
- Split `NodeIcon` into per-kind subcomponents (`DomainIcon`, `ProjectIcon`, `GoalIcon`, `TagIcon`, `TaskIcon`) with a router `NodeIcon` component
- Split `MindmapNode` into `NodeRect` and `NodeLabel` subcomponents
- Extracted drag placeholder overlay into `DragPlaceholder` component
- Replaced `DomainEditorModal` and `TagEditorModal` (identical except heading) with unified `TitleEditorModal`
- Extracted canvas layout computation (effectiveCollapsedIds, positions, subtreeLayout, placeholderPos) into `src/hooks/use-canvas-layout.ts`
- Extracted node type cycling and retype-warning state into `src/hooks/use-node-type-manager.ts`
- Extracted editor modal state and all node save handlers into `src/hooks/use-node-editor.ts`
- Extracted node mutation callbacks (`onStatusClick`, `onCommitEdit`, `onCreateChild`, `onDelete`, `onPaste`) into `src/hooks/use-node-actions.ts`
- Moved `buildRetypeActions` into `use-node-type-manager`; hook now returns `retypeActions` directly
- All editor modals now use a shared `EditorModal` shell for consistent layout
- `MindmapView` reduced from 919 to 161 lines; all remaining code is wiring and JSX
- Replaced all magic strings with named constants co-located with their domain: `TASK_STATUS`/`GOAL_STATUS` in `status-mapping.ts`, `CLIPBOARD_OP` in `use-mindmap-store.ts`, `GOAL_CHILDREN_ACTION` in `use-mindmap-data.ts`, `WARNING_VARIANT` in `WarningConfirmModal.tsx`, `DOMAIN_SUBTYPE` in `api/domains.ts`, `CONTEXT_ACTION` in `NodeContextMenu.tsx`
- `useKeyboardMindmap` option `warningModal` replaced with `isWarningActive: boolean`, eliminating the banned `as` type assertion at the call site
- `useDrag` absorbs drop execution (`{ tree, moveNode }` options); `handleDrop` removed from `MindmapView`
- Context-menu dispatch extracted into `use-context-action.ts`; arrow-key navigation into `use-navigate-arrow.ts`
- All hooks specific to one component relocated into that component's directory; `src/hooks/` removed

### Added
- Drag-and-drop to re-parent nodes: drag any non-aspect node onto a valid parent and release to move it; valid drop targets highlight in the accent colour; invalid targets (e.g. dropping a goal onto a task, or a node onto one of its own descendants) are silently rejected
- Drag ghost: while dragging, the source node is hidden and a semi-transparent copy follows the cursor; a dashed outline placeholder appears at the predicted landing position under the hovered parent; the dragged node's children are hidden from the live tree and rendered as smaller dashed outlines (with internal edges) inside the placeholder, so the full subtree structure is visible at the drop position

### Fixed
- Drag-and-drop now works in Tauri/WebKit: replaced the HTML5 drag API (unreliable on SVG elements in WebKitGTK) with mouse-event drag-and-drop using `onMouseDown` + global `mousemove`/`mouseup` and `document.elementsFromPoint` for hit-testing

### Fixed
- Alt+Up / Alt+Down no longer causes a white flash and pan/zoom reset: mutations now refresh the tree silently without triggering the loading spinner, so the canvas stays mounted
- Changing node type (Ctrl+Arrow) no longer moves the node to the bottom of its siblings: the new entity now inherits the old entity's position value instead of receiving a fresh epoch-ms timestamp
- Warning confirmation modal now receives keyboard focus when opened (cancel button auto-focused); Escape dismisses it and all other mindmap shortcuts are blocked while it is visible
- goal↔task type conversion no longer shows a warning for task children: task nodes are valid under both goals and tasks, so only goal children (which cannot live under a task) and a present block reason trigger the confirmation modal

### Added
- Mindmap view: SVG mind map editor with a left-right balanced tree layout
  - All Domains, Projects, Goals, and Tasks displayed as a unified tree rooted at the six Aspects
  - Pan (middle-click drag) and zoom (scroll/pinch) with spring animation
  - Visual spatial arrow-key navigation (nearest node in screen direction)
  - Tab to create a child node with inline title entry; Enter to confirm, Esc to cancel
  - Context menu on right-click: enter subtree, rename, cycle type, cut/copy/paste, collapse/expand, delete
  - Ctrl+X/C/V keyboard shortcuts for cut/copy/paste as child
  - Double-click opens an editor modal for title and tag assignment
  - Drag-and-drop to re-parent nodes
  - Ctrl+Up / Ctrl+Down cycles node type; cycle is context-aware: under a domain/project/aspect parent the full set (domain → project → tag → goal → task) is available; under a goal only goal↔task; task under task cannot become a goal
  - Cross-table type conversion (e.g. domain→goal, goal→domain): creates the new entity, re-parents compatible children, and deletes the old record
  - Alt+Up / Alt+Down moves a node up or down among its siblings (swaps position values)
  - Nodes now retain insertion order instead of being sorted alphabetically (`position` column added to domains, goals, and tasks; ORDER BY position)
  - Tag nodes now visible in the tree as leaf nodes (previously hidden); type cycling and Tab creation respect leaf-node constraint
  - Aspect color inherited by all descendant nodes with depth-faded opacity (vivid at depth 1, 15 % floor at depth 4+)
  - F2 to activate inline editing on the selected node
  - Enter subtree mode via context menu; subtree navigation pill in top-left; Esc to go up, Shift+Esc to return to root
  - Ctrl+/ to collapse/expand a subtree; Delete key to delete a node
  - Depth-based node scaling (root largest, stabilises at depth 4)
- Per-type editor modals (Task, Goal, Domain, Project, Tag) — each with entity-specific fields
  - Task modal: title, status pills (todo / in progress / done), block reason textarea, tag checkboxes, dependency search/add/remove
  - Goal modal: title, status pills (active / achieved / frozen / archived), block reason textarea, tag checkboxes
  - Domain and Tag modals: title only
  - Project modal: title, status pills, knowledge base directory path
  - Error messages surface inside the modal instead of being silently swallowed
- SVG node icons replacing emoji: diamond (domain), flag (project), bullseye (goal), price-tag (tag), status-based circles (task: empty/filled/checkmark for todo/in_progress/done, red octagon for blocked)
- Clicking the icon area of a task node cycles its status (todo → in_progress → done → todo); blocked tasks show a stop sign that is not clickable
- App icon generated from the Arlesh logo SVG (32 × 32, 128 × 128, 128 × 128@2x, .icns, .ico)
- `list_task_dependencies` Tauri command (was missing despite the repository method existing)
- ESLint configured (flat config v9+) with typescript-eslint, react-hooks, and react-refresh plugins
- Phase 1 data layer: SQLite schema, sqlx migrations, domain-first Rust module structure
- `domains` module: CRUD for Aspects (seeded, immutable), Projects, Domains, Tags with parent/subtype validation
- `tasks` module: CRUD for Tasks and Goals, dependency tracking with cycle detection, virtual blocker resolution
- `scopes` module: lazy get-or-create for Season/Month/Week/Day scopes with denormalized containment columns
- `knowledge_base` module: CRUD for People, Events, Threads (stub; no Obsidian integration yet)
- `commands` module: thin Tauri IPC wrappers for all domain operations
- `src-tauri/.cargo/config.toml` setting build target to `/tmp/arlesh-target` (Rust debug artifacts are large)
- 22 integration tests covering all modules: DB migrations, domain validation, task dependency/blocking, scope containment, KB entities

## [0.1.0] — 2026-06-20

### Added
- Initial design specification (`SPEC.md`) covering:
  - Domain/Aspect/Project/Goal/Task resource model
  - Tag structure (flat leaves under a domain)
  - Knowledge-base entities: People, Scopes, Events, Threads
  - Scope containment model with denormalized columns
  - Link inheritance rules per type (additive vs. override)
  - Three-mode filter logic (Any / All / Exclusion)
  - Mindmap view: left-right balanced tree, SVG renderer, D3 layout
  - List view: task rows with clickable tag/parent chips, goal visibility toggle, four preset modes
  - Five implementation phases
- Tech stack decision: Tauri 2.0 + React + TypeScript + SQLite
