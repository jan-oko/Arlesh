import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import MindmapTree from "./MindmapTree";
import type { MindmapNode, Orientation } from "@/utils/tree-layout";

function node(id: string, children: MindmapNode[] = []): MindmapNode {
  return { id, kind: "domain", title: id, position: 0, tagIds: [], children };
}

const TREE = node("root", [node("child")]);

function renderTree(orientation: Orientation) {
  const { container } = render(
    <svg>
      <MindmapTree
        root={TREE}
        orientation={orientation}
        collapsedNodeIds={new Set()}
        selectedNodeIds={new Set()}
        editingNodeId={null}
        dragTargetId={null}
        dragSourceId={null}
        hasClipboard={false}
        onSelect={vi.fn()}
        onDoubleClick={vi.fn()}
        onCommitEdit={vi.fn()}
        onCancelEdit={vi.fn()}
        onContextAction={vi.fn()}
        onDragStart={vi.fn()}
        onStatusClick={vi.fn()}
      />
    </svg>,
  );
  const edge = container.querySelector("path[stroke='var(--edge-color)']");
  return edge?.getAttribute("d") ?? "";
}

describe("MindmapTree edges", () => {
  it("leaves the root's side when horizontal", () => {
    // Root is a depth-0 box 200 wide at the origin, so the edge starts on its right face.
    expect(renderTree("horizontal")).toMatch(/^M 100 0 /);
  });

  it("leaves the root's underside when vertical", () => {
    // Same box, 52 tall — the edge now starts below the root, on its own x.
    expect(renderTree("vertical")).toMatch(/^M 0 26 /);
  });
});
