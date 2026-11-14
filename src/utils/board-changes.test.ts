import { describe, expect, it } from "vitest";
import type { MindmapLoad } from "@/api/mindmap";
import { applyBoardChanges, compactJson, differingCollections, entriesOf, indexBoard, recomputeHash } from "@/utils/board-changes";

/** A board as the producer's JSON gives it: rows are opaque to the apply path, which reads keys only. */
function isLoad(value: unknown): value is MindmapLoad {
  return typeof value === "object" && value !== null && Array.isArray(Reflect.get(value, "tasks"));
}

function load(parts: Record<string, unknown>): MindmapLoad {
  const empty = {
    domains: [], goals: [], tasks: [], commitments: [], expectations: [], infos: [], flows: [], flow_goals: [],
    flow_tasks: [], flow_commitments: [], flow_expectations: [], flow_cycles: [], flow_dependencies: [],
    block_reasons: [], task_dependencies: [], flow_instance_nodes: [], lifecycles: [], habits: [],
  };
  const parsed: unknown = JSON.parse(JSON.stringify({ ...empty, ...parts }));
  if (!isLoad(parsed)) throw new Error("not a board");
  return parsed;
}

function board(): MindmapLoad {
  return load({
    tasks: [
      { id: 1, title: "one" },
      { id: 2, title: "two" },
      { id: 3, title: "three" },
    ],
    block_reasons: [
      { owner_type: "task", owner_id: 1, reason: "a", position: 1 },
      { owner_type: "task", owner_id: 1, reason: "b", position: 2 },
      { owner_type: "task", owner_id: 2, reason: "c", position: 1 },
    ],
    short_ids: { "task-1": "a1" },
    agent_activity: { review: 0, waits: 0, on_agent: 0 },
  });
}

describe("applyBoardChanges", () => {
  it("keeps a replaced row where it was", () => {
    const held = indexBoard(board());

    const next = applyBoardChanges(held, { tasks: { set: [["task-2", { id: 2, title: "TWO" }]], del: [] } });

    expect(next.load.tasks.map((task) => task.title)).toEqual(["one", "TWO", "three"]);
  });

  it("appends a new row and drops a deleted one", () => {
    const held = indexBoard(board());

    const next = applyBoardChanges(held, { tasks: { set: [["task-9", { id: 9, title: "nine" }]], del: ["task-1"] } });

    expect(next.load.tasks.map((task) => task.id)).toEqual([2, 3, 9]);
  });

  it("keeps the identity of every collection with no changes", () => {
    const held = indexBoard(board());

    const next = applyBoardChanges(held, { tasks: { set: [], del: ["task-1"] } });

    expect(next.load.block_reasons).toBe(held.load.block_reasons);
    expect(next.load.domains).toBe(held.load.domains);
    expect(next.load.tasks).not.toBe(held.load.tasks);
  });

  it("replaces a group whole, dropping the old group's rows", () => {
    const held = indexBoard(board());

    const next = applyBoardChanges(held, {
      block_reasons: { set: [["task-1", [{ owner_type: "task", owner_id: 1, reason: "only", position: 1 }]]], del: [] },
    });

    expect(next.load.block_reasons.map((reason) => reason.reason)).toEqual(["only", "c"]);
  });

  it("drops a whole group by its key", () => {
    const held = indexBoard(board());

    const next = applyBoardChanges(held, { block_reasons: { set: [], del: ["task-1"] } });

    expect(next.load.block_reasons.map((reason) => reason.reason)).toEqual(["c"]);
  });

  it("sets and drops entries of a map and replaces the one value", () => {
    const held = indexBoard(board());

    const next = applyBoardChanges(held, {
      short_ids: { set: [["task-2", "a2"]], del: ["task-1"] },
      agent_activity: { set: [["agent_activity", { review: 2, waits: 0, on_agent: 1 }]], del: [] },
    });

    expect(next.load.short_ids).toEqual({ "task-2": "a2" });
    expect(next.load.agent_activity).toEqual({ review: 2, waits: 0, on_agent: 1 });
  });

  it("keeps the running digests equal to a fresh index of the result", () => {
    const held = indexBoard(board());

    const next = applyBoardChanges(held, {
      tasks: { set: [["task-2", { id: 2, title: "TWO" }], ["task-9", { id: 9, title: "nine" }]], del: ["task-3"] },
      block_reasons: { set: [], del: ["task-2"] },
      short_ids: { set: [["task-9", "a9"]], del: [] },
    });

    const fresh = indexBoard(next.load);
    expect(next.digests.total).toBe(fresh.digests.total);
    expect(next.digests.sums).toEqual(fresh.digests.sums);
    expect([...next.digests.byEntry.entries()].sort()).toEqual([...fresh.digests.byEntry.entries()].sort());
  });

  it("does not change the board it was given", () => {
    const held = indexBoard(board());
    const before = JSON.stringify(held.load);

    applyBoardChanges(held, { tasks: { set: [["task-2", { id: 2, title: "TWO" }]], del: ["task-1"] } });

    expect(JSON.stringify(held.load)).toBe(before);
  });
});

describe("compactJson", () => {
  it("writes an integer past 2^53 in full, as the producer does", () => {
    expect(compactJson({ position: -(2 ** 63) })).toBe('{"position":-9223372036854775808}');
    expect(compactJson([2 ** 63])).toBe("[9223372036854775807]");
  });

  it("is JSON.stringify for everything else", () => {
    const value = { a: [1, 2.5, "é\u2028", null, true], b: { c: 1234567890123456 - 1 } };

    expect(compactJson(value)).toBe(JSON.stringify(value));
  });
});

describe("the board hash", () => {
  it("does not depend on the order rows are held in", () => {
    const forward = board();
    const backward = load({ ...board(), tasks: [...board().tasks].reverse() });

    expect(recomputeHash(forward)).toBe(recomputeHash(backward));
  });

  it("changes with any value", () => {
    const changed = load({ ...board(), tasks: [{ id: 1, title: "ONE" }, ...board().tasks.slice(1)] });

    expect(recomputeHash(changed)).not.toBe(recomputeHash(board()));
  });

  it("names the collections whose sums differ", () => {
    const changed = load({ ...board(), short_ids: { "task-1": "zz" } });

    expect(differingCollections(indexBoard(board()).digests.sums, indexBoard(changed).digests.sums)).toEqual(["short_ids"]);
  });

  it("groups block reasons by owner and counts a map entry once", () => {
    const entries = entriesOf(board());

    expect(entries.filter((entry) => entry.collection === "block_reasons").map((entry) => entry.key)).toEqual(["task-1", "task-2"]);
    expect(entries.filter((entry) => entry.collection === "short_ids")).toHaveLength(1);
  });
});
