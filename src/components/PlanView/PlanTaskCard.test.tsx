import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import PlanTaskCard from "./PlanTaskCard";
import type { TaskListRow } from "@/utils/list-filter";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/use-scope-range-label", () => ({ useScopeRangeLabel: () => null }));
vi.mock("@/hooks/use-tag-names", () => ({ useTagNames: () => new Map() }));

function n(id: string, kind: NodeKind, extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id, kind, title: id, position: 0, tagIds: [], children: [], ...extra };
}

function row(over: Partial<TaskListRow> = {}): TaskListRow {
  return {
    node: n("task-1", "task", { status: "todo" }),
    ancestors: [],
    goalRef: null,
    goalStatus: null,
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

function props(taskRow: TaskListRow): ComponentProps<typeof PlanTaskCard> {
  return {
    row: taskRow,
    isSelected: false,
    direction: "in",
    showPath: true,
    onSelect: vi.fn(),
    onMove: vi.fn(),
    onOpenEditor: vi.fn(),
    onDragStart: vi.fn(),
  };
}

function cardOf(container: HTMLElement): HTMLElement {
  const card = container.querySelector<HTMLElement>("[data-plan-card-id]");
  if (card === null) throw new Error("no card rendered");
  return card;
}

describe("PlanTaskCard — colour", () => {
  it("is its aspect's, the same at depth 0 as six levels down", () => {
    const shallow = render(<PlanTaskCard {...props(row({ node: n("task-1", "task", { color: "#27ae60" }) }))} />);
    expect(cardOf(shallow.container).style.getPropertyValue("--card-aspect")).toBe("#27ae60");
    shallow.unmount();

    const deep = render(<PlanTaskCard {...props(row({
      node: n("task-9", "task", { color: "#27ae60" }),
      ancestors: [n("a", "aspect"), n("d", "domain"), n("p", "project"), n("g", "goal"), n("t1", "task"), n("t2", "task")],
    }))} />);
    expect(cardOf(deep.container).style.getPropertyValue("--card-aspect")).toBe("#27ae60");
  });

  it("carries no depth-faded tint", () => {
    const { container } = render(<PlanTaskCard {...props(row({
      node: n("task-9", "task", { color: "#27ae60" }),
      ancestors: [n("a", "aspect"), n("d", "domain"), n("g", "goal")],
    }))} />);
    expect(cardOf(container).style.getPropertyValue("--card-tint-opacity")).toBe("");
  });

  it("is the plain card surface outside any aspect", () => {
    const { container } = render(<PlanTaskCard {...props(row())} />);
    expect(cardOf(container).style.getPropertyValue("--card-aspect")).toBe("");
  });
});

describe("PlanTaskCard — path line", () => {
  it("shows no path line for a card with nothing above it", () => {
    render(<PlanTaskCard {...props(row())} />);
    // The title stands alone in the card's body: no placeholder line above it.
    expect(screen.getByText("task-1").parentElement?.childElementCount).toBe(1);
  });

  it("shows its ancestors' path when it has one", () => {
    render(<PlanTaskCard {...props(row({ ancestors: [n("p", "project", { title: "LANG" })] }))} />);
    expect(screen.getByText("LANG")).toBeInTheDocument();
  });
});
