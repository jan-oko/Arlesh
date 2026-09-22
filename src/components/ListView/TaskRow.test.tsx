import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ComponentProps } from "react";
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
    ancestors: [n("goal-1", "goal", { title: "Ship it" })],
    goalRef: "goal-1",
    goalStatus: "active",
    projectRef: null,
    projectStatus: null,
    dependencyRefs: [],
    isBlocked: false,
    isAgentic: false,
    isAsynchronous: false,
    hasBlockedAncestor: false,
    hasPrivateAncestor: false,
    scopeTokens: ["unscoped", "unplanned"],
    ...over,
  };
}

function baseProps(overrides: Partial<ComponentProps<typeof TaskRow>> = {}) {
  return {
    row: row(),
    visibleDepth: 0,
    isSelected: false,
    isFocusExempt: false,
    isEditingTitle: false,
    onSelect: vi.fn(),
    onCycleStatus: vi.fn(),
    onOpenEditor: vi.fn(),
    onCommitTitle: vi.fn(),
    onCancelTitleEdit: vi.fn(),
    onAddTagFilter: vi.fn(),
    ...overrides,
  };
}

describe("TaskRow — Agentic badge", () => {
  it("badges an agentic task in the list, as the canvas does", () => {
    render(<TaskRow {...baseProps({ row: row({ node: n("task-1", "task", { status: "todo", agentic: true }) }) })} />);
    expect(screen.getByTitle("agentic")).toBeInTheDocument();
  });

  it("badges a task that inherited the flag", () => {
    render(<TaskRow {...baseProps({ row: row({ node: n("task-1", "task", { status: "todo", inheritedAgentic: true }) }) })} />);
    expect(screen.getByTitle("agentic")).toBeInTheDocument();
  });

  it("leaves an unflagged task unbadged", () => {
    render(<TaskRow {...baseProps()} />);
    expect(screen.queryByTitle("agentic")).not.toBeInTheDocument();
  });
});

describe("TaskRow — Asynchronous badge", () => {
  it("badges a task whose doing starts a wait", () => {
    render(<TaskRow {...baseProps({ row: row({ node: n("task-1", "task", { status: "todo", asynchronous: true }) }) })} />);
    expect(screen.getByTitle("asynchronous")).toBeInTheDocument();
  });

  it("leaves an unflagged task unbadged", () => {
    render(<TaskRow {...baseProps()} />);
    expect(screen.queryByTitle("asynchronous")).not.toBeInTheDocument();
  });
});

describe("TaskRow", () => {
  it("clicking the status control cycles status when not blocked", () => {
    const onCycleStatus = vi.fn();
    render(<TaskRow {...baseProps({ onCycleStatus })} />);
    fireEvent.click(screen.getByLabelText("cycleStatus"));
    expect(onCycleStatus).toHaveBeenCalledWith("task-1");
  });

  it("disables the status control while the task is blocked", () => {
    render(<TaskRow {...baseProps({ row: row({ isBlocked: true }) })} />);
    expect(screen.getByLabelText("cycleStatus")).toBeDisabled();
  });

  it("still allows cycling a virtual Habit instance even though it reads as blocked-like", () => {
    const habitRow = row({
      node: n("task-1", "task", { status: "todo", habitItem: { flowId: 1, itemType: "flow_task", itemId: 2, scopeId: 3, cycleId: 0 } }),
      isBlocked: true,
    });
    render(<TaskRow {...baseProps({ row: habitRow })} />);
    expect(screen.getByLabelText("cycleStatus")).not.toBeDisabled();
  });

  it("clicking the title opens the editor", () => {
    const onOpenEditor = vi.fn();
    render(<TaskRow {...baseProps({ onOpenEditor })} />);
    fireEvent.click(screen.getByText("task-1"));
    expect(onOpenEditor).toHaveBeenCalledWith("task-1");
  });

  it("double-clicking the card opens the editor", () => {
    const onOpenEditor = vi.fn();
    const { container } = render(<TaskRow {...baseProps({ onOpenEditor })} />);
    const card = container.querySelector("[class*='card']");
    expect(card).not.toBeNull();
    if (card !== null) fireEvent.doubleClick(card);
    expect(onOpenEditor).toHaveBeenCalledWith("task-1");
  });

  it("clicking anywhere on the card selects it", () => {
    const onSelect = vi.fn();
    const { container } = render(<TaskRow {...baseProps({ onSelect })} />);
    const card = container.querySelector("[class*='card']");
    expect(card).not.toBeNull();
    if (card !== null) fireEvent.click(card);
    expect(onSelect).toHaveBeenCalledWith("task-1");
  });

  it("shows a selected style when isSelected is true", () => {
    const { container } = render(<TaskRow {...baseProps({ isSelected: true })} />);
    expect(container.querySelector("[class*='cardSelected']")).not.toBeNull();
  });

  describe("indentation", () => {
    function card(container: HTMLElement): HTMLElement {
      const found = container.querySelector<HTMLElement>("[class*='card']");
      if (found === null) throw new Error("expected a task card");
      return found;
    }

    it("a row with no visible ancestor asks for no indentation", () => {
      const { container } = render(<TaskRow {...baseProps({ visibleDepth: 0 })} />);
      expect(card(container).style.getPropertyValue("--row-depth")).toBe("0");
    });

    it("a row two visible ancestors down is indented twice", () => {
      const { container } = render(<TaskRow {...baseProps({ visibleDepth: 2 })} />);
      expect(card(container).style.getPropertyValue("--row-depth")).toBe("2");
    });

    it("indents the whole card, so the status control and badges move with it", () => {
      const { container } = render(<TaskRow {...baseProps({ visibleDepth: 1 })} />);
      const indented = card(container);
      expect(indented.style.getPropertyValue("--row-depth")).toBe("1");
      // The control lives inside the card that carries the indent, not beside it.
      expect(indented.querySelector("[class*='statusButton']")).not.toBeNull();
    });

    it("indents a left-to-right title from the start edge", () => {
      const { container } = render(<TaskRow {...baseProps({ visibleDepth: 1 })} />);
      expect(card(container).className).toMatch(/indentLtr/);
    });

    it("indents a right-to-left title from the other edge, so a Hebrew task steps in from where its text starts", () => {
      const hebrew = row({ node: n("task-1", "task", { status: "todo", title: "\u05DE\u05E9\u05D9\u05DE\u05D4" }) });
      const { container } = render(<TaskRow {...baseProps({ row: hebrew, visibleDepth: 1 })} />);
      expect(card(container).className).toMatch(/indentRtl/);
      expect(card(container).className).not.toMatch(/indentLtr/);
    });
  });

  // The path header above the run names the parent already; the card restating it was the whole
  // case for retiring the Parent dimension, so the label goes with it. Tags stay: a tag is in no
  // header, and clicking one here is the only way to add it from the row.
  it("names no parent on the card, since the path header above the run already does", () => {
    render(<TaskRow {...baseProps()} />);
    expect(screen.queryByText("Ship it")).not.toBeInTheDocument();
  });

  it("clicking a tag pill adds a tag filter, resolving the tag's name", () => {
    const onAddTagFilter = vi.fn();
    render(<TaskRow {...baseProps({ row: row({ node: n("task-1", "task", { status: "todo", tagIds: [7] }) }), onAddTagFilter })} />);
    fireEvent.click(screen.getByText("urgent"));
    expect(onAddTagFilter).toHaveBeenCalledWith(7);
  });

  describe("inline rename", () => {
    it("shows an input with the current title when isEditingTitle is true", () => {
      render(<TaskRow {...baseProps({ isEditingTitle: true })} />);
      expect(screen.getByRole("textbox")).toHaveValue("task-1");
      expect(screen.queryByText("task-1")).not.toBeInTheDocument();
    });

    it("Enter commits the new title", () => {
      const onCommitTitle = vi.fn();
      render(<TaskRow {...baseProps({ isEditingTitle: true, onCommitTitle })} />);
      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "New title" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onCommitTitle).toHaveBeenCalledWith("task-1", "New title");
    });

    it("blur commits the new title", () => {
      const onCommitTitle = vi.fn();
      render(<TaskRow {...baseProps({ isEditingTitle: true, onCommitTitle })} />);
      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "Blurred title" } });
      fireEvent.blur(input);
      expect(onCommitTitle).toHaveBeenCalledWith("task-1", "Blurred title");
    });

    it("Escape cancels without committing", () => {
      const onCommitTitle = vi.fn();
      const onCancelTitleEdit = vi.fn();
      render(<TaskRow {...baseProps({ isEditingTitle: true, onCommitTitle, onCancelTitleEdit })} />);
      fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
      expect(onCancelTitleEdit).toHaveBeenCalledTimes(1);
      expect(onCommitTitle).not.toHaveBeenCalled();
    });

    it("clicking inside the rename input does not re-trigger row selection", () => {
      const onSelect = vi.fn();
      render(<TaskRow {...baseProps({ isEditingTitle: true, onSelect })} />);
      fireEvent.click(screen.getByRole("textbox"));
      expect(onSelect).not.toHaveBeenCalled();
    });
  });
});
