import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import type { ScopeKey } from "@/api/scopes";
import type { TaskListRow } from "@/utils/list-filter";
import type { MindmapNode } from "@/utils/tree-layout";
import { usePlanPanes } from "./use-plan-panes";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const WEEK: ScopeKey = { kind: "week", date: "2026-09-20" };
const MONTH: ScopeKey = { kind: "month", date: "2026-09-01" };

function row(id: string): TaskListRow {
  const node: MindmapNode = { id, kind: "task", title: id, position: 0, tagIds: [], children: [] };
  return {
    node, ancestors: [], goalRef: null, goalStatus: null, projectRef: null, projectStatus: null,
    dependencyRefs: [], isBlocked: false, heldByBlockedAncestor: false, isAgentic: false,
    isAsynchronous: false, hasPrivateAncestor: false, scopeTokens: [],
  };
}

const answer = (unplanned: string[], planned: string[] = []) => ({ unplanned, planned, parentPlanned: [], refusals: {} });

describe("usePlanPanes", () => {
  beforeEach(() => { vi.mocked(invoke).mockReset(); });

  it("shows the heaps Rust triaged the rows into", async () => {
    vi.mocked(invoke).mockResolvedValue(answer(["a"], ["b"]));
    const rows = [row("a"), row("b")];

    const { result } = renderHook(() => usePlanPanes(rows, WEEK, MONTH));

    await waitFor(() => expect(result.current.planned.map((r) => r.node.id)).toEqual(["b"]));
    expect(result.current.unplanned.map((r) => r.node.id)).toEqual(["a"]);
    expect(invoke).toHaveBeenCalledWith("plan_triage", expect.objectContaining({ target: WEEK, parent: MONTH }));
  });

  it("asks again when the rows change, and keeps the last heaps until the answer arrives", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(answer(["a"]));
    const first = [row("a")];
    const { result, rerender } = renderHook(({ rows }) => usePlanPanes(rows, WEEK, null), { initialProps: { rows: first } });
    await waitFor(() => expect(result.current.unplanned).toHaveLength(1));
    let release: (value: ReturnType<typeof answer>) => void = () => undefined;
    vi.mocked(invoke).mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));

    rerender({ rows: [row("a"), row("c")] });

    expect(result.current.unplanned.map((r) => r.node.id)).toEqual(["a"]);
    release(answer(["a", "c"]));
    await waitFor(() => expect(result.current.unplanned.map((r) => r.node.id)).toEqual(["a", "c"]));
  });

  it("drops an answer to a scope that has since changed", async () => {
    let releaseWeek: (value: ReturnType<typeof answer>) => void = () => undefined;
    vi.mocked(invoke).mockReturnValueOnce(new Promise((resolve) => { releaseWeek = resolve; }));
    vi.mocked(invoke).mockResolvedValueOnce(answer(["b"]));
    const rows = [row("a"), row("b")];
    const { result, rerender } = renderHook(({ target }) => usePlanPanes(rows, target, null), { initialProps: { target: WEEK } });

    rerender({ target: MONTH });
    await waitFor(() => expect(result.current.unplanned.map((r) => r.node.id)).toEqual(["b"]));
    releaseWeek(answer(["a"]));

    await Promise.resolve();
    expect(result.current.unplanned.map((r) => r.node.id)).toEqual(["b"]);
  });

  it("is empty with no scope to fill, and asks nothing", () => {
    const { result } = renderHook(() => usePlanPanes([row("a")], null, null));

    expect(result.current).toEqual({ unplanned: [], planned: [], parentPlanned: [] });
    expect(invoke).not.toHaveBeenCalled();
  });
});
