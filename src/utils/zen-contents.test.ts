import { describe, it, expect } from "vitest";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { DEFAULT_FILTER } from "@/utils/filter-tree";
import type { FilterState } from "@/utils/filter-tree";
import { flattenCommitmentRows, flattenExpectationRows, flattenTaskRows } from "@/utils/list-data";
import { zenContents } from "./zen-contents";
import type { ZenOptions, ZenSourceRows } from "./zen-contents";

function n(id: string, kind: NodeKind, over: Partial<MindmapNode> = {}): MindmapNode {
  return { id, kind, title: id, position: 0, tagIds: [], children: [], rowId: 1, ...over };
}

const root = n("root", "domain", {
  children: [
    n("goal-1", "goal", {
      status: "active",
      children: [
        n("task-doing", "task", {
          status: "in_progress",
          children: [n("task-doing-child", "task", { status: "in_progress", asynchronous: true })],
        }),
        n("task-todo", "task", { status: "todo" }),
        n("task-done", "task", { status: "done" }),
        n("task-second", "task", { status: "in_progress", tagIds: [7], agentic: true, compound: true }),
      ],
    }),
    n("commitment-open", "commitment", { verdict: "unresolved" }),
    n("commitment-kept", "commitment", { verdict: "kept" }),
    n("expectation-live", "expectation", { status: "pending" }),
    n("expectation-checked", "expectation", { status: "pending", checkEvery: { n: 1, kind: "day" } }),
    n("expectation-ahead", "expectation", { status: "pending", timing: "pending" }),
    n("expectation-released", "expectation", { status: "released" }),
  ],
});

const source: ZenSourceRows = {
  tasks: flattenTaskRows(root, []),
  commitments: flattenCommitmentRows(root),
  expectations: flattenExpectationRows(root),
};

const BOTH: ZenOptions = { commitments: true, expectations: true, agentic: [], showsStarted: false, showsCompound: true };

function ids(rows: ReadonlyArray<{ node: { id: string } }>): string[] {
  return rows.map((row) => row.node.id);
}

function read(shared: Partial<FilterState> = {}, strips: ZenOptions = BOTH, focusedId: string | null = null) {
  return zenContents(source, { ...DEFAULT_FILTER, ...shared }, strips, focusedId);
}

describe("zenContents", () => {
  it("shows the in-progress Tasks in plain board order, whatever the tab's own preset", () => {
    for (const statusMode of ["all", "plan", "start", "do", "backlog"] as const) {
      expect(ids(read({ statusMode }).tasks.rows)).toEqual(["task-doing", "task-doing-child", "task-second"]);
    }
  });

  it("puts the unresolved Commitments in their strip", () => {
    expect(ids(read().commitments.rows)).toEqual(["commitment-open"]);
  });

  it("puts the Expectations Start would show in their strip", () => {
    expect(ids(read().expectations.rows)).toEqual(["expectation-live", "expectation-checked"]);
  });

  it("honours Start hides waits that have checks in the Expectations strip", () => {
    expect(ids(read({ startHidesCheckedWaits: true }).expectations.rows)).toEqual(["expectation-live"]);
  });

  it("draws nothing in a strip the tab has hidden", () => {
    const contents = read({}, { commitments: false, expectations: false, agentic: [], showsStarted: false, showsCompound: true });
    expect(contents.commitments.rows).toEqual([]);
    expect(contents.expectations.rows).toEqual([]);
    expect(ids(contents.tasks.rows)).toHaveLength(3);
  });

  it("still applies the shared tag filter", () => {
    const contents = read({ tagFilters: [{ tagId: 7, mode: "all" }] });
    expect(ids(contents.tasks.rows)).toEqual(["task-second"]);
  });

  it("narrows the grid by the Agentic pill, in its modes, and leaves the strips alone", () => {
    const agentic = read({}, { ...BOTH, agentic: [{ value: "agentic", mode: "all" }] });
    expect(ids(agentic.tasks.rows)).toEqual(["task-second"]);
    expect(ids(agentic.commitments.rows)).toEqual(["commitment-open"]);
    expect(ids(agentic.expectations.rows)).toEqual(["expectation-live", "expectation-checked"]);
    const notAgentic = read({}, { ...BOTH, agentic: [{ value: "agentic", mode: "exclude" }] });
    expect(ids(notAgentic.tasks.rows)).toEqual(["task-doing", "task-doing-child"]);
  });

  it("keeps the selected card when it stops matching, and says it is exempted", () => {
    const contents = read({}, BOTH, "task-done");
    expect(ids(contents.tasks.rows)).toEqual(["task-doing", "task-doing-child", "task-done", "task-second"]);
    expect(contents.tasks.exemptedIds).toEqual(new Set(["task-done"]));
  });

  it("shows a compound task on the grid while the setting is on", () => {
    expect(ids(read().tasks.rows)).toContain("task-second");
  });

  it("leaves a compound task off the grid while the setting is off, and keeps its sub-items", () => {
    const off = { ...BOTH, showsCompound: false };
    expect(ids(read({}, off).tasks.rows)).toEqual(["task-doing", "task-doing-child"]);
  });

  it("keeps a selected compound task on the grid with the setting off, as exempted", () => {
    const contents = read({}, { ...BOTH, showsCompound: false }, "task-second");
    expect(ids(contents.tasks.rows)).toEqual(["task-doing", "task-doing-child", "task-second"]);
    expect(contents.tasks.exemptedIds).toEqual(new Set(["task-second"]));
  });
});

describe("zenContents — Agentic Tasks", () => {
  const agenticTask = (id: string, status: "todo" | "on_agent" | "review" | "doing" | "done", over: Partial<MindmapNode> = {}) =>
    n(id, "task", { status, taskStatus: { kind: "agentic", status }, agentic: true, ...over });
  const agentRoot = n("root", "domain", {
    children: [
      n("task-mine", "task", { status: "in_progress", taskStatus: { kind: "ordinary", status: "in_progress" } }),
      agenticTask("task-held", "on_agent", {
        children: [n("expectation-ci", "expectation", { status: "pending", agentWaiting: { note: "CI", question: false, answer: null } })],
      }),
      agenticTask("task-taken", "doing"),
      agenticTask("task-asking", "review", {
        children: [n("expectation-question", "expectation", { status: "pending", agentWaiting: { note: null, question: true, answer: null } })],
      }),
      n("expectation-person", "expectation", { status: "pending" }),
    ],
  });
  const agentSource: ZenSourceRows = {
    tasks: flattenTaskRows(agentRoot, []),
    commitments: flattenCommitmentRows(agentRoot),
    expectations: flattenExpectationRows(agentRoot),
  };
  const readAgents = (shared: Partial<FilterState> = {}) => zenContents(agentSource, { ...DEFAULT_FILTER, ...shared }, BOTH, null);

  it("leads with Review, keeps Doing, and hides On Agent", () => {
    expect(ids(readAgents().tasks.rows)).toEqual(["task-asking", "task-mine", "task-taken"]);
  });

  it("shows On Agent while the On Agent pill is on", () => {
    expect(ids(readAgents({ showOnAgent: true }).tasks.rows)).toEqual(["task-asking", "task-mine", "task-held", "task-taken"]);
  });

  it("keeps every agentic wait out of the Expectations strip, question or not", () => {
    expect(ids(readAgents().expectations.rows)).toEqual(["expectation-person"]);
  });

  it("shows Review whatever the Started setting says", () => {
    const contents = zenContents(agentSource, DEFAULT_FILTER, { ...BOTH, showsStarted: false }, null);
    expect(ids(contents.tasks.rows)).toContain("task-asking");
  });
});
