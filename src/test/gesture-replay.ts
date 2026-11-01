/**
 * Replays a gesture operation's writes (`runGesture`) onto the per-command `src/api/` functions a
 * test has mocked, one call per write, so a test written against those calls still reads what a
 * Save or a paste writes. Targets are resolved as the backend resolves them: `{step}` is the node an
 * earlier write made, `{step, forked, id}` the node a Habit fork replaced.
 *
 * Only the api modules are loaded, through their module ids, so whatever a test mocked is what is
 * called; a write whose function the test did not mock throws, naming it.
 */

type Fn = (...args: unknown[]) => unknown;

const MODULES = [
  "@/api/tasks", "@/api/goals", "@/api/commitments", "@/api/expectations", "@/api/flows",
  "@/api/domains", "@/api/infos", "@/api/block-reasons",
] as const;

async function functions(): Promise<Map<string, Fn>> {
  const found = new Map<string, Fn>();
  for (const id of MODULES) {
    const module: unknown = await import(/* @vite-ignore */ id);
    if (typeof module !== "object" || module === null) continue;
    for (const [name, value] of Object.entries(module)) {
      if (typeof value === "function") found.set(name, (...args: unknown[]) => Reflect.apply(value, undefined, args));
    }
  }
  return found;
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function resolve(target: unknown, made: unknown[]): unknown {
  const step = field(target, "step");
  if (typeof step !== "number") return target;
  const answer = made[step];
  const forked = field(target, "forked");
  if (typeof forked === "string") {
    const id = field(target, "id");
    if (answer === null || answer === undefined) return id;
    if (forked === "flow") return field(answer, "flow_id");
    const kinds: Record<string, string> = { flow_goal: "goals", flow_task: "tasks", flow_commitment: "commitments", flow_expectation: "expectations" };
    const pairs = field(answer, kinds[forked] ?? "");
    const pair = Array.isArray(pairs) ? pairs.find((entry: unknown) => Array.isArray(entry) && entry[0] === id) : undefined;
    return Array.isArray(pair) ? pair[1] : id;
  }
  return field(answer, "id") ?? field(field(answer, "copy"), "id");
}

const TAG_FUNCTIONS: Record<string, [string, string]> = {
  task: ["addTagToTask", "removeTagFromTask"],
  goal: ["addTagToGoal", "removeTagFromGoal"],
  commitment: ["addTagToCommitment", "removeTagFromCommitment"],
  expectation: ["addTagToExpectation", "removeTagFromExpectation"],
};

/** The api call one write stands for: its function's name and arguments. */
function callOf(step: unknown, target: (key: string) => unknown): [string, unknown[]] {
  const get = (key: string): unknown => field(step, key);
  const present = get("present") === true;
  switch (get("op")) {
    case "update_task": {
      const settle = get("descendant_plans");
      return settle === undefined
        ? ["updateTask", [target("id"), get("request")]]
        : ["updateTaskSettlingPlans", [target("id"), get("request"), settle]];
    }
    case "update_goal": return ["updateGoal", [target("id"), get("request")]];
    case "update_commitment": return ["updateCommitment", [target("id"), get("request")]];
    case "update_expectation": return ["updateExpectation", [target("id"), get("request")]];
    case "update_info": return ["updateInfo", [target("id"), get("request")]];
    case "update_domain": return ["updateDomain", [target("id"), get("request")]];
    case "update_flow": return ["updateFlow", [target("id"), get("request")]];
    case "update_flow_item": return ["updateFlowItem", [get("item_type"), target("id"), get("request")]];
    case "set_task_done_at": return ["setTaskDoneAt", [target("id"), get("at")]];
    case "set_block_reasons": return ["setBlockReasons", [get("owner_type"), target("id"), get("reasons")]];
    case "set_tag": {
      const names = TAG_FUNCTIONS[String(get("kind"))] ?? ["", ""];
      return [present ? names[0] : names[1], [target("id"), get("tag_id")]];
    }
    case "set_task_dependency":
      return [present ? "addTaskDependency" : "removeTaskDependency", [target("task_id"), get("dependency")]];
    case "set_flow_item_cycles": {
      const reconcile = get("reconcile");
      return ["setFlowItemCycles", [
        target("flow_id"), get("item_type"), target("item_id"), get("cycles"),
        reconcile, reconcile === undefined ? undefined : "now",
      ]];
    }
    case "set_flow_dependency":
      return present
        ? ["addFlowDependency", [target("flow_id"), get("dependent_type"), target("dependent_id"), get("depends_on_type"), target("depends_on_id")]]
        : ["removeFlowDependency", [get("dependent_type"), target("dependent_id"), get("depends_on_type"), target("depends_on_id")]];
    case "set_flow_recurrence": return ["setFlowRecurrence", [target("flow_id"), get("request")]];
    case "delete_flow_recurrence": return ["deleteFlowRecurrence", [target("flow_id")]];
    case "clear_habit_modifications": return ["clearHabitModifications", [target("flow_id")]];
    case "fork_flow": return ["forkFlow", [target("flow_id"), "now"]];
    case "create_flow": return ["createFlow", [get("request")]];
    case "create_expectation": return ["createExpectation", [get("request")]];
    case "create_task": return ["createTask", [get("request")]];
    case "create_goal": return ["createGoal", [get("request")]];
    default: throw new Error(`gesture-replay: no api call for write ${String(get("op"))}`);
  }
}

/** Runs `steps` against the mocked api functions, in order, answering what each answered. */
export async function replayGesture(_name: string, steps: readonly unknown[]): Promise<unknown[]> {
  const api = await functions();
  const made: unknown[] = [];
  for (const step of steps) {
    const [name, args] = callOf(step, (key) => resolve(field(step, key), made));
    const call = api.get(name);
    if (call === undefined) throw new Error(`gesture-replay: the test did not mock ${name}`);
    made.push((await call(...args)) ?? null);
  }
  return made;
}
