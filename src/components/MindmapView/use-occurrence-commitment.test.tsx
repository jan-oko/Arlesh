import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useCallback, useState } from "react";
import { render, screen, fireEvent, waitFor, renderHook, act } from "@testing-library/react";
import { useMindmapData } from "./use-mindmap-data";
import { useNodeActions } from "./use-node-actions";
import CommitmentEditorModal from "@/components/CommitmentEditorModal/CommitmentEditorModal";
import type { CommitmentSaveData } from "@/components/CommitmentEditorModal/CommitmentEditorModal";
import { findNode } from "@/utils/mindmap-tree";
import type { MindmapLoad } from "@/api/mindmap";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { testKey } from "@/test/scope-key";

// Nothing under `@/api` is mocked here, on purpose. The question is what Shift+C on a Habit
// occurrence actually puts *on the wire*: the occurrence is a row with a UUID id (ADR 0008), and
// the new commitment hangs from it by that id like from any other parent. So the seam stubbed is
// Tauri's IPC entry point itself — the function `invoke` hands the command to — with every hop
// above it (hotkey action, editor, hook, `src/api`, the Gesture protocol) real.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "ltr" } }),
}));

// A stable object, matching the real hook's `useMemo`. The `t` above is a fresh function every
// render, so the real `useScopeLabels` would hand back a new object each time and spin
// `useMindmapData`'s `useEffect(() => { void load(); }, [load])` forever.
vi.mock("@/hooks/use-scope-labels", () => {
  const labels = {
    unscoped: "Unscoped",
    unplanned: "Unplanned",
    week: (n: number) => `W${n}`,
    month: (m: number) => `M${m}`,
    season: (name: string) => name,
    duration: (count: number, kind: string) => `${count} ${kind}`,
  };
  return { useScopeLabels: () => labels };
});

declare global {
  interface Window {
    __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: unknown) => Promise<unknown> };
  }
}

const FLOW_ID = 3;
/** The occurrence's row id: a derived row's UUID. */
const OCCURRENCE_ROW = "6f1c2d4e-0000-5000-8000-000000000003";
/** The node id the board builds for it, as for any Task row. */
const OCCURRENCE_ID = `task-${OCCURRENCE_ROW}`;
/** The row `create_commitment` reports back. */
const NEW_COMMITMENT_ID = 42;

const WINDOW = { start_id: testKey(7), end_id: testKey(9) };

function envelope(): MindmapLoad {
  return {
    domains: [{
      id: 1, title: "Work", description: null, subtype: "aspect", parent_id: null, color: null,
      status: null, knowledge_base_directory: null, position: 0, is_private: false,
    }],
    goals: [{
      id: 1, title: "Sleep well", parent_type: "domain", parent_id: 1, status: "active",
      time_scope: null, on_scope_exit: null, tag_ids: [], position: 0, is_private: false,
    }],
    tasks: [{
      id: OCCURRENCE_ROW, title: "Evening routine", parent_type: "goal", parent_id: 1,
      status: "todo", time_scope: null, on_scope_exit: null, plan: null, tag_ids: [], position: 0,
      is_private: false, delegate_to: null, agentic: null, asynchronous: false,
      archival: "live",
      origin: {
        kind: "habit", habit_id: FLOW_ID, item_type: "flow_root", item_id: FLOW_ID, cycle_id: 0,
        iteration_scope: {
          index: 0, start_date: "2026-01-05", window_end: "2099-01-01T00:00:00",
          scope_id: "day:2026-01-05", kind: "day", status: "active",
        },
      },
    }],
    commitments: [], expectations: [], expectation_checks: [], spawned_waits: [], infos: [],
    flows: [{
      id: FLOW_ID, title: "Evening routine", instance_type: "task",
      parent_type: "domain", parent_id: 1, target_type: "goal", target_id: 1,
      flow_duration_n: 1, flow_duration_kind: "day",
      flow_window_part: null, flow_window_time_start: null, flow_window_time_end: null,
      is_habit: true, root_plan_kind: null, root_plan_start: null, root_plan_end: null,
      verdict_window_n: null, verdict_window_kind: null, position: 0, is_private: false,
    }],
    flow_goals: [], flow_tasks: [], flow_cycles: [], flow_dependencies: [],
    block_reasons: [], task_dependencies: [], flow_instance_nodes: [], lifecycles: [],
    habits: [{ flow_id: FLOW_ID, flow_title: "Evening routine", result: { outcome: "loaded" } }],
  };
}

/** Commands a test wants the backend to refuse, and what it refuses them with. */
const refusals = new Map<string, unknown>();

const ipc = vi.fn((cmd: string, _args?: unknown): Promise<unknown> => {
  const refusal = refusals.get(cmd);
  if (refusal !== undefined) return Promise.reject(refusal);
  if (cmd === "load_mindmap") return Promise.resolve(envelope());
  if (cmd === "open_gesture") return Promise.resolve("gesture-under-test");
  if (cmd === "list_domains") return Promise.resolve([]);
  if (cmd === "create_commitment") return Promise.resolve({ id: NEW_COMMITMENT_ID });
  return Promise.resolve(null);
});

beforeEach(() => {
  ipc.mockClear();
  refusals.clear();
  window.__TAURI_INTERNALS__ = { invoke: ipc };
});

afterEach(() => {
  delete window.__TAURI_INTERNALS__;
});

/** Every command that reached the IPC boundary, in order, with the Gesture protocol dropped. */
function commands(): string[] {
  return ipc.mock.calls
    .map((call) => call[0])
    .filter((cmd) => cmd !== "open_gesture" && cmd !== "close_gesture");
}

/** The arguments `command` reached the boundary with, as JSON round-tripped them. */
function wireArgs(command: string): Record<string, unknown> {
  const call = ipc.mock.calls.find(([cmd]) => cmd === command);
  if (call === undefined) throw new Error(`${command} never reached the IPC boundary`);
  const sent: unknown = JSON.parse(JSON.stringify(call[1] ?? {}));
  if (sent === null || typeof sent !== "object") throw new Error(`${command}'s args are not an object`);
  return { ...sent };
}

const BLANK_COMMITMENT: MindmapNode = {
  id: "commitment-new", kind: "commitment", title: "", position: 0, tagIds: [], children: [],
};

const noop = (): void => {};

// Plain identifiers rather than JSX text: the i18next lint rule does not know this button is a
// test harness standing in for a canvas selection and a hotkey.
const LOADING_LABEL = "loading";
const SHIFT_C_LABEL = "shift+c";

/**
 * The canvas, minus the canvas: the selection's Shift+C, the editor it opens and the write its
 * Save runs, wired exactly as `MindmapView` wires them.
 */
function Harness() {
  const {
    tree, isLoading, createNode, createChild, renameNode, moveNode, duplicateNode,
    createCommitment, reload,
  } = useMindmapData();
  const [parent, setParent] = useState<{ id: string; kind: NodeKind } | null>(null);

  const onNewCommitment = useCallback(
    (parentId: string) => {
      const node = findNode(tree, parentId);
      if (node === undefined) return;
      setParent({ id: parentId, kind: node.kind });
    },
    [tree],
  );

  const { onCreateTypedChild } = useNodeActions({
    tree, clipboard: null, moveNode, duplicateNode, onRequestDelete: noop, reload, renameNode,
    createNode, createChild, selectNode: noop, setClipboard: noop, setEditingNodeId: noop,
    showToast: noop, onNewFlow: noop, onNewCommitment,
  });

  if (isLoading) return <div>{LOADING_LABEL}</div>;
  return (
    <>
      <button type="button" onClick={() => onCreateTypedChild(OCCURRENCE_ID, "commitment")}>
        {SHIFT_C_LABEL}
      </button>
      {parent !== null && (
        <CommitmentEditorModal
          node={BLANK_COMMITMENT}
          allTags={[]}
          domainNames={new Map()}
          heading="newCommitment"
          onSave={(data) => createCommitment(parent.id, parent.kind, data)}
          onClose={() => setParent(null)}
        />
      )}
    </>
  );
}

describe("Shift+C on a Habit occurrence", () => {
  it("hangs the commitment from the occurrence's own row id, like any parent", async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByText(SHIFT_C_LABEL)).toBeInTheDocument());

    fireEvent.click(screen.getByText(SHIFT_C_LABEL));
    fireEvent.change(await screen.findByLabelText("fieldTitle"), {
      target: { value: "Asleep by 23:00" },
    });
    fireEvent.click(screen.getByText("save"));

    await waitFor(() => expect(commands()).toContain("create_commitment"));
    expect(wireArgs("create_commitment")).toEqual({
      request: {
        title: "Asleep by 23:00",
        parent_type: "task",
        parent_id: OCCURRENCE_ROW,
        verdict: "unresolved",
      },
    });
  });
});

describe("a Commitment created under a Habit occurrence", () => {
  const save: CommitmentSaveData = {
    title: "Asleep by 23:00",
    verdict: "kept",
    tagIds: [5],
    timeScope: WINDOW,
    verdictWindow: { n: 2, kind: "day" },
    isPrivate: true,
  };

  async function create(): Promise<void> {
    const { result } = renderHook(() => useMindmapData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.createCommitment(OCCURRENCE_ID, "task", save);
    });
  }

  it("carries the fields the editor set in the create itself, and the rest after it", async () => {
    await create();

    expect(wireArgs("create_commitment")).toEqual({
      request: {
        title: "Asleep by 23:00",
        parent_type: "task",
        parent_id: OCCURRENCE_ROW,
        verdict: "kept",
        time_scope: WINDOW,
        verdict_window: { n: 2, kind: "day" },
      },
    });
    expect(wireArgs("update_commitment")).toEqual({ id: NEW_COMMITMENT_ID, request: { is_private: true } });
    expect(wireArgs("add_tag_to_commitment")).toEqual({ commitmentId: NEW_COMMITMENT_ID, tagId: 5 });
  });

  it("finishes configuring the row before the board reloads, so it never appears half-made", async () => {
    await create();

    const order = commands();
    const reloads = order.reduce<number[]>((acc, cmd, index) => {
      if (cmd === "load_mindmap") acc.push(index);
      return acc;
    }, []);
    expect(reloads).toHaveLength(2);
    expect(order.indexOf("update_commitment")).toBeLessThan(reloads[1] ?? -1);
    expect(order.indexOf("add_tag_to_commitment")).toBeLessThan(reloads[1] ?? -1);
  });
});

describe("a parent with no row behind it and no occurrence either", () => {
  it("names the node rather than sending a parent id that is not a number", async () => {
    const { result } = renderHook(() => useMindmapData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(
      result.current.createCommitment("habitgroup-3-virtual", "task", {
        title: "Asleep by 23:00", verdict: "unresolved", tagIds: [],
        timeScope: null, verdictWindow: null, isPrivate: false,
      }),
    ).rejects.toThrow('Node "habitgroup-3-virtual" is not in the tree');
    expect(commands()).not.toContain("create_commitment");
  });
});
