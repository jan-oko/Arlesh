import { describe, expect, it, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSubtreeNav } from "@/hooks/use-subtree-nav";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import type { MindmapNode } from "@/utils/tree-layout";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => (key === "appName" ? "Arlesh" : key) }),
}));

function node(id: string, title: string, children: MindmapNode[] = []): MindmapNode {
  return { id, kind: "project", title, position: 0, tagIds: [], children };
}

describe("useSubtreeNav", () => {
  beforeEach(() => {
    useMindmapStore.setState({ subtreeRootId: null, subtreeNav: null });
  });

  it("names the path's first segment for the app, whatever the tree's root is called", () => {
    // A view that named its root for itself ("List") would otherwise show that in the path.
    const tree = node("root", "List", [node("a", "Aspect", [node("p", "Project")])]);
    useMindmapStore.setState({ subtreeRootId: "p" });
    renderHook(() => useSubtreeNav(tree));
    expect(useMindmapStore.getState().subtreeNav?.ancestors.map((crumb) => crumb.title)).toEqual(["Arlesh", "Aspect"]);
  });
});
