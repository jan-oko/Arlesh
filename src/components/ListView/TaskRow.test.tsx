import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TaskRow from "./TaskRow";
import type { TaskListRow } from "@/utils/list-filter";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/use-tag-names", () => ({ useTagNames: () => new Map([[7, "urgent"]]) }));
vi.mock("@/hooks/use-scope-range-label", () => ({ useScopeRangeLabel: () => null }));

function n(id: string, kind: NodeKind, extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id, kind, title: id, position: 0, tagIds: [], children: [], ...extra };
}

function row(over: Partial<TaskListRow> = {}): TaskListRow {
  return {
    node: n("task-1", "task", { status: "todo" }),
    parentRef: "goal-1",
    ancestorRefs: ["goal-1"],
    ancestors: [n("goal-1", "goal", { title: "Ship it" })],
    goalRef: "goal-1",
    goalStatus: "active",
    projectRef: null,
    projectStatus: null,
    dependencyRefs: [],
    isBlocked: false,
    hasBlockedAncestor: false,
    hasNsfwAncestor: false,
    scopeTokens: ["unscoped", "unplanned"],
    ...over,
  };
}

describe("TaskRow", () => {
  it("clicking the status control cycles status when not blocked", () => {
    const onCycleStatus = vi.fn();
    render(<TaskRow row={row()} onCycleStatus={onCycleStatus} onOpenEditor={vi.fn()} onAddParentFilter={vi.fn()} onAddTagFilter={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("cycleStatus"));
    expect(onCycleStatus).toHaveBeenCalledWith("task-1");
  });

  it("disables the status control while the task is blocked", () => {
    render(<TaskRow row={row({ isBlocked: true })} onCycleStatus={vi.fn()} onOpenEditor={vi.fn()} onAddParentFilter={vi.fn()} onAddTagFilter={vi.fn()} />);
    expect(screen.getByLabelText("cycleStatus")).toBeDisabled();
  });

  it("still allows cycling a virtual Habit instance even though it reads as blocked-like", () => {
    const habitRow = row({
      node: n("task-1", "task", { status: "todo", habitItem: { flowId: 1, itemType: "flow_task", itemId: 2, scopeId: 3 } }),
      isBlocked: true,
    });
    render(<TaskRow row={habitRow} onCycleStatus={vi.fn()} onOpenEditor={vi.fn()} onAddParentFilter={vi.fn()} onAddTagFilter={vi.fn()} />);
    expect(screen.getByLabelText("cycleStatus")).not.toBeDisabled();
  });

  it("clicking the title opens the editor", () => {
    const onOpenEditor = vi.fn();
    render(<TaskRow row={row()} onCycleStatus={vi.fn()} onOpenEditor={onOpenEditor} onAddParentFilter={vi.fn()} onAddTagFilter={vi.fn()} />);
    fireEvent.click(screen.getByText("task-1"));
    expect(onOpenEditor).toHaveBeenCalledWith("task-1");
  });

  it("double-clicking the card opens the editor", () => {
    const onOpenEditor = vi.fn();
    const { container } = render(
      <TaskRow row={row()} onCycleStatus={vi.fn()} onOpenEditor={onOpenEditor} onAddParentFilter={vi.fn()} onAddTagFilter={vi.fn()} />,
    );
    const card = container.querySelector("[class*='card']");
    expect(card).not.toBeNull();
    if (card !== null) fireEvent.doubleClick(card);
    expect(onOpenEditor).toHaveBeenCalledWith("task-1");
  });

  it("clicking the parent label adds a parent filter", () => {
    const onAddParentFilter = vi.fn();
    render(<TaskRow row={row()} onCycleStatus={vi.fn()} onOpenEditor={vi.fn()} onAddParentFilter={onAddParentFilter} onAddTagFilter={vi.fn()} />);
    fireEvent.click(screen.getByText("Ship it"));
    expect(onAddParentFilter).toHaveBeenCalledWith("goal-1");
  });

  it("clicking a tag pill adds a tag filter, resolving the tag's name", () => {
    const onAddTagFilter = vi.fn();
    render(
      <TaskRow
        row={row({ node: n("task-1", "task", { status: "todo", tagIds: [7] }) })}
        onCycleStatus={vi.fn()}
        onOpenEditor={vi.fn()}
        onAddParentFilter={vi.fn()}
        onAddTagFilter={onAddTagFilter}
      />,
    );
    fireEvent.click(screen.getByText("urgent"));
    expect(onAddTagFilter).toHaveBeenCalledWith(7);
  });
});
