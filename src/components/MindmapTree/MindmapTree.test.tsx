import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import MindmapTree from "./MindmapTree";
import type { MindmapNode, Orientation } from "@/utils/tree-layout";

// An occurrence draws its status badges, whose tooltips look up tag names; nothing here needs an
// answer, only that the lookup does not reach for a Tauri runtime the test does not have.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue([]) }));

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

describe("a folded run of Habit iterations", () => {
  const RUN: MindmapNode = {
    id: "habitrun-7-virtual",
    kind: "habit_group",
    title: "14 passed · 9 done, 5 missed",
    virtual: true,
    habitGroup: {
      flowId: 7, level: "run", passed: 14, done: 9, missed: 5,
      spanStart: "2026-09-01", spanEnd: "2026-09-14", spanLabel: "01/09/26–14/09/26",
    },
    position: 0,
    tagIds: [],
    children: [node("habit-7-0-virtual"), node("habit-7-1-virtual")],
  };
  const TREE_WITH_RUN = node("root", [RUN]);

  function renderRun(collapsedNodeIds: ReadonlySet<string>) {
    return render(
      <svg>
        <MindmapTree
          root={TREE_WITH_RUN}
          orientation="horizontal"
          collapsedNodeIds={collapsedNodeIds}
          selectedNodeIds={new Set()}
          focusExemptIds={new Set()}
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

  it("reads its tally and keeps the iterations behind it off screen", () => {
    const { container } = renderRun(new Set(["habitrun-7-virtual"]));

    expect(container.textContent).toContain("14 passed · 9 done, 5 missed");
    expect(container.querySelector("[data-node-id='habit-7-0-virtual']")).toBeNull();
  });

  it("draws its iterations once it is expanded", () => {
    const { container } = renderRun(new Set());

    expect(container.querySelector("[data-node-id='habit-7-0-virtual']")).not.toBeNull();
  });

  it("names its span in a tooltip, since the node itself has no room for it", () => {
    const { container } = renderRun(new Set(["habitrun-7-virtual"]));

    expect(container.querySelector("[data-node-id='habitrun-7-virtual'] title")?.textContent)
      .toBe("01/09/26–14/09/26");
  });
});

describe("MindmapTree — a Habit occurrence's context menu", () => {
  const occurrence: MindmapNode = {
    id: "habititem-flow_task-4-0-0-virtual", kind: "task", title: "Run", status: "todo", position: 0,
    tagIds: [], children: [], virtual: true,
    habitItem: { flowId: 3, itemType: "flow_task", itemId: 4, scopeId: 100, cycleId: 0 },
    occurrence: { templateTitle: "Run", ownTitle: null, blockedReason: null, dependsOn: [], deleted: false },
  };

  function renderOccurrence(onContextAction = vi.fn(), onDoubleClick = vi.fn()) {
    const { container } = render(
      <svg>
        <MindmapTree
          root={node("root", [occurrence])}
          orientation="horizontal"
          collapsedNodeIds={new Set()}
          selectedNodeIds={new Set()}
          focusExemptIds={new Set()}
          editingNodeId={null}
          dragTargetId={null}
          dragSourceId={null}
          hasClipboard={false}
          onSelect={vi.fn()}
          onDoubleClick={onDoubleClick}
          onCommitEdit={vi.fn()}
          onCancelEdit={vi.fn()}
          onContextAction={onContextAction}
          onDragStart={vi.fn()}
          onStatusClick={vi.fn()}
        />
      </svg>,
    );
    const target = container.querySelector(`[data-node-id='${occurrence.id}']`);
    if (target === null) throw new Error("occurrence not drawn");
    return target;
  }

  it("opens a menu of what applies to the occurrence, and sends the pick", () => {
    const onContextAction = vi.fn();
    fireEvent.contextMenu(renderOccurrence(onContextAction));
    const labels = screen.getAllByRole("menuitem").map((item) => item.textContent);
    expect(labels).toContain("occurrence.edit");
    expect(labels).toContain("occurrence.delete");
    expect(labels).not.toContain("cut");
    fireEvent.click(screen.getByRole("menuitem", { name: "occurrence.edit" }));
    expect(onContextAction).toHaveBeenCalledWith(occurrence.id, "edit");
  });

  it("routes a double-click on the occurrence to the editor", () => {
    const onDoubleClick = vi.fn();
    fireEvent.doubleClick(renderOccurrence(vi.fn(), onDoubleClick));
    expect(onDoubleClick).toHaveBeenCalledWith(occurrence.id);
  });
});
