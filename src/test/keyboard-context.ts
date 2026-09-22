import { vi } from "vitest";
import type { useKeyboardListView } from "@/components/ListView/use-keyboard-list-view";
import type { useKeyboardMindmap } from "@/components/MindmapView/use-keyboard-mindmap";
import type { MindmapNode } from "@/utils/tree-layout";

/**
 * The one place a keyboard context is enumerated.
 *
 * Three test files used to list every member of `ListContext` or `MindmapContext` by hand, so
 * adding a single `on*` member broke all three — and any two branches adding one broke them in the
 * same place. They share these two builders instead: a feature that adds a member adds it here,
 * once, and every test that does not care about it carries on unchanged.
 *
 * The callbacks are `vi.fn()` spies, so a test asserts on the one it cares about by reading it back
 * off the object the builder returned.
 */

type ListOptions = Parameters<typeof useKeyboardListView>[0];
type MindmapOptions = Parameters<typeof useKeyboardMindmap>[0];

/** A plain Task, for the default selection. */
export function makeFixtureTask(id: string): MindmapNode {
  return { id, kind: "task", title: "Task", position: 0, tagIds: [], children: [] };
}

/**
 * List View's keyboard context, with one Task selected and nothing filtered.
 *
 * `selectedRowId` is whichever of the two kinds is selected, exactly as ListView derives it —
 * computed rather than defaulted, so a test that says "nothing is selected" is not silently
 * contradicted by a stale row id. Pass it explicitly to override that.
 */
export function listKeyboardContext(overrides: Partial<ListOptions> = {}): ListOptions {
  const merged: ListOptions = {
    isInputActive: false,
    selectedTaskId: "task-1",
    selectedCommitmentId: null,
    selectedRowId: null,
    isSelectedBlocked: false,
    subtreeRootId: null,
    onNavigate: vi.fn(),
    onScrollList: vi.fn(),
    onCycleStatus: vi.fn(),
    onOpenEditor: vi.fn(),
    onStartRename: vi.fn(),
    onCreateSibling: vi.fn(),
    onCreateChild: vi.fn(),
    onDelete: vi.fn(),
    onDeselect: vi.fn(),
    onToggleFilter: vi.fn(),
    onSetStatusMode: vi.fn(),
    onSetUnblockPreset: vi.fn(),
    onOpenSearch: vi.fn(),
    onExitSubtree: vi.fn(),
    onExitToRoot: vi.fn(),
    onToggleBacklog: vi.fn(),
    onToggleAgentic: vi.fn(),
    onToggleAsynchronous: vi.fn(),
    onCycleVerdict: vi.fn(),
    onMarkBroken: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onToggleFullscreen: vi.fn(),
    ...overrides,
  };
  return {
    ...merged,
    selectedRowId: overrides.selectedRowId ?? merged.selectedTaskId ?? merged.selectedCommitmentId,
  };
}

/** The Mindmap's keyboard context, with one Task selected on an empty canvas. */
export function mindmapKeyboardContext(overrides: Partial<MindmapOptions> = {}): MindmapOptions {
  return {
    isInputActive: false,
    isWarningActive: false,
    onDismissWarning: vi.fn(),
    selectedNodeId: "task-1",
    selectedNodeIds: new Set(["task-1"]),
    subtreeRootId: null,
    clipboard: null,
    orientation: "horizontal",
    findNodeById: (id: string) => (id === "task-1" ? makeFixtureTask("task-1") : undefined),
    onNavigate: vi.fn(),
    onPanCanvas: vi.fn(),
    onCycleType: vi.fn(),
    onReorder: vi.fn(),
    onStartRename: vi.fn(),
    onCreateChild: vi.fn(),
    onCreateTypedChild: vi.fn(),
    onCreateSibling: vi.fn(),
    onInsertParent: vi.fn(),
    onOpenEditor: vi.fn(),
    onStartFlow: vi.fn(),
    onDelete: vi.fn(),
    onToggleCollapsed: vi.fn(),
    onCycleStatus: vi.fn(),
    onCycleVerdict: vi.fn(),
    onMarkBroken: vi.fn(),
    onDeselect: vi.fn(),
    onExitSubtree: vi.fn(),
    onExitToRoot: vi.fn(),
    onCut: vi.fn(),
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    onEnterSubtree: vi.fn(),
    onOpenSearch: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onToggleFilter: vi.fn(),
    onSetStatusMode: vi.fn(),
    onToggleBacklog: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onToggleAgentic: vi.fn(),
    onToggleAsynchronous: vi.fn(),
    onToggleFullscreen: vi.fn(),
    onFocusRoot: vi.fn(),
    onCenterOnNode: vi.fn(),
    onConvertToFlow: vi.fn(),
    onExtendSelection: vi.fn(),
    ...overrides,
  };
}
