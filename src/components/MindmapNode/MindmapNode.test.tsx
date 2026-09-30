import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import MindmapNode from "./MindmapNode";
import type { MindmapNode as MindmapNodeData } from "@/utils/tree-layout";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/use-tag-names", () => ({ useTagNames: () => new Map() }));
vi.mock("@/hooks/use-scope-range-label", () => ({ useScopeRangeLabel: () => null }));

function node(extra: Partial<MindmapNodeData> = {}): MindmapNodeData {
  return { id: "task-1", rowId: 1, kind: "task", title: "Late work", status: "todo", position: 0, tagIds: [], children: [], ...extra };
}

function draw(data: MindmapNodeData, isSelected = false) {
  return render(
    <svg>
      <MindmapNode
        node={data}
        parentKind={null}
        position={{ x: 0, y: 0, depth: 1 }}
        isSelected={isSelected}
        isFocusExempt={false}
        isCollapsed={false}
        isDragTarget={false}
        hasClipboard={false}
        isEditing={false}
        onSelect={vi.fn()}
        onDoubleClick={vi.fn()}
        onCommitEdit={vi.fn()}
        onCancelEdit={vi.fn()}
        onContextAction={vi.fn()}
        onDragStart={vi.fn()}
      />
    </svg>,
  );
}

function outline(container: HTMLElement): string | null {
  return container.querySelector("rect")?.getAttribute("stroke") ?? null;
}

describe("MindmapNode — Overdue", () => {
  it("draws the amber border and says Overdue in its description", () => {
    const { container, getByRole } = draw(node({ overdue: true }));
    expect(outline(container)).toBe("var(--overdue)");
    expect(getByRole("treeitem")).toHaveAccessibleDescription("overdue");
  });

  it("takes the selected-and-Overdue colour when selected", () => {
    const { container } = draw(node({ overdue: true }), true);
    expect(outline(container)).toBe("var(--overdue-selected)");
  });

  it("keeps the plain selection colour on a selected node that is not Overdue", () => {
    const { container, getByRole } = draw(node(), true);
    expect(outline(container)).toBe("var(--node-border-selected)");
    expect(getByRole("treeitem")).not.toHaveAttribute("aria-describedby");
  });
});
