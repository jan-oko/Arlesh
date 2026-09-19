import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { useNodeActions } from "./use-node-actions";
import { duplicateTask } from "@/api/tasks";
import { CLIPBOARD_OP } from "@/stores/use-mindmap-store";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";

/**
 * The seam the whole granularity design exists for: a paste of several nodes reaching the backend
 * as one undo step rather than one per node.
 *
 * Nothing between `onPaste` and Tauri is stubbed out — the hook calls a real `src/api/` function,
 * which goes through the Gesture wrapper — so this fails if any layer stops opening or joining the
 * Gesture, which counting the hook's own calls could not catch.
 */

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
  }),
}));

/** Which Gesture each write belonged to, modelling the backend's joining opens. */
interface Journal {
  writes: Array<{ command: string; gesture: string | null }>;
  started: number;
  /** Opens not yet closed. Anything but 0 once the paste has settled is a leaked Gesture. */
  depth: number;
}

function installBackend(): Journal {
  const journal: Journal = { writes: [], started: 0, depth: 0 };
  let current: string | null = null;

  vi.mocked(tauriInvoke).mockImplementation((command: string) => {
    if (command === "open_gesture") {
      journal.depth += 1;
      if (journal.depth === 1) {
        journal.started += 1;
        current = `gesture-${journal.started}`;
      }
      return Promise.resolve(current);
    }
    if (command === "close_gesture") {
      journal.depth -= 1;
      if (journal.depth === 0) current = null;
      return Promise.resolve(null);
    }
    journal.writes.push({ command, gesture: current });
    return Promise.resolve({ id: 1 });
  });

  return journal;
}

function node(id: string, kind: NodeKind, children: MindmapNode[] = []): MindmapNode {
  return { id, kind, title: id, position: 0, tagIds: [], children };
}

const TREE = node("root", "domain", [
  node("domain-9", "domain"),
  node("task-1", "task"),
  node("task-2", "task"),
  node("task-3", "task"),
]);

function renderPaste() {
  return renderHook(() =>
    useNodeActions({
      tree: TREE,
      clipboard: { operation: CLIPBOARD_OP.COPY, nodeIds: ["task-1", "task-2", "task-3"] },
      // The real path from the hook to Tauri: `duplicateNode` is `use-mindmap-data`'s dispatch to
      // the api layer, which is where the Gesture wrapper sits.
      moveNode: vi.fn(() => Promise.resolve()),
      duplicateNode: async (id, _kind, targetId, _targetKind, position) => {
        await duplicateTask(
          parseInt(id.split("-")[1] ?? "0", 10),
          "domain",
          parseInt(targetId.split("-")[1] ?? "0", 10),
          position,
        );
      },
      onRequestDelete: vi.fn(),
      reload: () => Promise.resolve(),
      renameNode: vi.fn(() => Promise.resolve()),
      createNode: vi.fn(),
      createChild: vi.fn(),
      selectNode: vi.fn(),
      setClipboard: vi.fn(),
      setEditingNodeId: vi.fn(),
      showToast: vi.fn(),
    }),
  );
}

let journal: Journal;

beforeEach(() => {
  vi.clearAllMocks();
  journal = installBackend();
});

describe("pasting several nodes", () => {
  it("writes them all inside one gesture, so they are one undo step", async () => {
    const { result } = renderPaste();

    act(() => result.current.onPaste("domain-9"));

    await waitFor(() => expect(journal.writes).toHaveLength(3));
    expect(journal.writes.map((write) => write.command))
      .toEqual(["duplicate_task", "duplicate_task", "duplicate_task"]);
    expect(journal.started).toBe(1);
    expect(new Set(journal.writes.map((write) => write.gesture))).toEqual(new Set(["gesture-1"]));
  });

  // A Gesture left open would silently swallow every later write into the paste's undo step.
  it("leaves no gesture open behind it", async () => {
    const { result } = renderPaste();

    act(() => result.current.onPaste("domain-9"));

    await waitFor(() => expect(journal.writes).toHaveLength(3));
    await waitFor(() => expect(journal.depth).toBe(0));
  });
});
