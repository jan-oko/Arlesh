import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useCallback, useState } from "react";
import { render, screen, fireEvent, waitFor, renderHook, act } from "@testing-library/react";
import { useMindmapData } from "./use-mindmap-data";
import { useNodeActions } from "./use-node-actions";
import CommitmentEditorModal from "@/components/CommitmentEditorModal/CommitmentEditorModal";
import type { CommitmentSaveData } from "@/components/CommitmentEditorModal/CommitmentEditorModal";
import { findNode } from "@/utils/mindmap-tree";
import { NO_CYCLE } from "@/api/flows";
import type { MindmapLoad } from "@/api/mindmap";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";

// Nothing under `@/api` is mocked here, on purpose. The question is what Shift+C on a virtual
// Habit occurrence actually puts *on the wire*: an occurrence has no row id, so a create that
// hangs the new node from a parent id can only send rubbish for it. So the seam stubbed is Tauri's
// IPC entry point itself — the function `invoke` hands the command to — with every hop above it
// (hotkey action, editor, hook, `src/api`, the Gesture protocol) real.
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
const ITERATION_SCOPE_ID = 100;
/** The nightly Habit's first iteration, as `injectHabitInstances` ids it. */
const OCCURRENCE_ID = `habit-${FLOW_ID}-0-virtual`;
/** The row `create_habit_instance_child` reports back for the attached commitment. */
const NEW_COMMITMENT_ID = 42;

/** The quadruple that names the occurrence a child is attached to. */
const INSTANCE = {
  item_type: "flow_root",
  item_id: FLOW_ID,
  iteration_scope_id: ITERATION_SCOPE_ID,
  cycle_id: NO_CYCLE,
};

const WINDOW = { start_id: 7, end_id: 9 };

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
    tasks: [], commitments: [], expectations: [], infos: [],
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
    habit_instance_children: [],
    habits: [{
      flow_id: FLOW_ID,
      flow_title: "Evening routine",
      result: {
        outcome: "loaded",
        iterations: [{
          index: 0,
          anchor_scope_id: ITERATION_SCOPE_ID,
          anchor_date: "2026-01-05",
          // Far enough ahead that the iteration is open, so it renders as its own node rather
          // than folded into a passed-history group.
          window_end: "2099-01-01T00:00:00",
          status: "active",
          instances: [],
        }],
        statuses: [],
      },
    }],
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
  if (cmd === "create_habit_instance_child") {
    return Promise.resolve({ node_type: "commitment", node_id: NEW_COMMITMENT_ID });
  }
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
  it("attaches the commitment to the occurrence instead of hanging it from a parent id", async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByText(SHIFT_C_LABEL)).toBeInTheDocument());

    fireEvent.click(screen.getByText(SHIFT_C_LABEL));
    fireEvent.change(await screen.findByLabelText("fieldTitle"), {
      target: { value: "Asleep by 23:00" },
    });
    fireEvent.click(screen.getByText("save"));

    await waitFor(() => expect(commands()).toContain("create_habit_instance_child"));

    // An occurrence has no row id. `create_commitment` takes a non-optional `parent_id`, so every
    // way of reaching it from here sends something that is not one — `NaN`, which serialises to
    // JSON `null`, which comes back as "invalid type: null, expected i64".
    const strayCreate = ipc.mock.calls.find(([cmd]) => cmd === "create_commitment");
    expect(
      strayCreate,
      `create_commitment reached the IPC boundary with ${JSON.stringify(strayCreate?.[1])}`,
    ).toBeUndefined();

    expect(wireArgs("create_habit_instance_child")).toEqual({
      flowId: FLOW_ID,
      instance: INSTANCE,
      childType: "commitment",
      title: "Asleep by 23:00",
    });
  });
});

describe("a Commitment attached to a Habit occurrence", () => {
  const save: CommitmentSaveData = {
    title: "Asleep by 23:00",
    verdict: "kept",
    tagIds: [5],
    timeScope: WINDOW,
    verdictWindow: { n: 2, kind: "day" },
    isPrivate: true,
  };

  async function attach(): Promise<void> {
    const { result } = renderHook(() => useMindmapData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.createCommitment(OCCURRENCE_ID, "task", save);
    });
  }

  it("carries the fields the editor set onto the attached row", async () => {
    await attach();

    expect(wireArgs("update_commitment")).toEqual({
      id: NEW_COMMITMENT_ID,
      request: {
        verdict: "kept",
        time_scope: WINDOW,
        verdict_window: { n: 2, kind: "day" },
        is_private: true,
      },
    });
    expect(wireArgs("add_tag_to_commitment")).toEqual({
      commitmentId: NEW_COMMITMENT_ID,
      tagId: 5,
    });
  });

  it("finishes configuring the row before the board reloads, so it never appears half-made", async () => {
    await attach();

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

describe("a Commitment the occurrence's window will not hold", () => {
  it("takes the attached row back out rather than leaving it for a second Save to duplicate", async () => {
    refusals.set("update_commitment", "a commitment must sit within its parent's window");
    const { result } = renderHook(() => useMindmapData());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(
      result.current.createCommitment(OCCURRENCE_ID, "task", {
        title: "Asleep by 23:00", verdict: "unresolved", tagIds: [],
        // A window the occurrence's own day cannot contain — the editor stays open on it, so the
        // row the attachment already wrote must not survive to be made a second time.
        timeScope: WINDOW, verdictWindow: null, isPrivate: false,
      }),
    ).rejects.toThrow("a commitment must sit within its parent's window");

    expect(wireArgs("delete_commitment")).toEqual({ id: NEW_COMMITMENT_ID });
    expect(commands().filter((cmd) => cmd === "create_habit_instance_child")).toHaveLength(1);
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
