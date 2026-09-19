import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import MindmapTree from "./MindmapTree";
import type { MindmapNode, Orientation } from "@/utils/tree-layout";

function node(id: string, children: MindmapNode[] = []): MindmapNode {
  return { id, kind: "domain", title: id, position: 0, tagIds: [], children };
}

const TREE = node("root", [node("child")]);

function renderTreeIn(orientation: Orientation, focusExemptIds: ReadonlySet<string>) {
  return render(
    <svg>
      <MindmapTree
        root={TREE}
        orientation={orientation}
        collapsedNodeIds={new Set()}
        selectedNodeIds={new Set()}
        focusExemptIds={focusExemptIds}
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
}

function renderTree(orientation: Orientation) {
  const { container } = renderTreeIn(orientation, new Set());
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

describe("MindmapTree focus exemption", () => {
  it("dims a node held on screen only by the focus exemption, and nothing else", () => {
    const { container } = renderTreeIn("horizontal", new Set(["child"]));
    expect(container.querySelector("[data-node-id='child']")?.getAttribute("style")).toContain("opacity: 0.45");
    expect(container.querySelector("[data-node-id='root']")?.getAttribute("style") ?? "").not.toContain("opacity");
  });

  it("leaves every node at full strength when nothing is exempt", () => {
    const { container } = renderTreeIn("horizontal", new Set());
    expect(container.querySelector("[data-node-id='child']")?.getAttribute("style") ?? "").not.toContain("opacity");
  });
});
