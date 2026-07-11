import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import StatusIconRow from "./StatusIconRow";
import { deriveStatusIndicators } from "@/utils/node-status-indicators";
import { invalidateTagNames } from "@/hooks/use-tag-names";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "ltr" } }),
}));

function node(kind: NodeKind, extra: Partial<MindmapNode> = {}): MindmapNode {
  return { id: `${kind}-1`, kind, title: kind, position: 0, tagIds: [], children: [], ...extra };
}

function renderRow(n: MindmapNode) {
  const { container } = render(
    <svg>
      <StatusIconRow node={n} indicators={deriveStatusIndicators(n)} width={160} top={36} />
    </svg>,
  );
  return Array.from(container.querySelectorAll("title")).map((t) => t.textContent);
}

describe("StatusIconRow", () => {
  beforeEach(() => {
    // Resolve every IPC call so async scope/tag-name lookups settle instead of rejecting.
    vi.mocked(invoke).mockResolvedValue([]);
    invalidateTagNames();
  });

  it("renders a tooltip per indicator (keys resolve to i18n text at runtime)", () => {
    const scope = { start_id: 1, end_id: 2, duration: { n: 1, kind: "week" } };
    const titles = renderRow(node("task", { status: "todo", timeScope: scope, timing: "lapsed", resolution: "overdue" }));
    // scope clock (crossed) + overdue exclamation.
    expect(titles).toEqual(["scope", "overdue"]);
  });

  it("uses a distinct tooltip for an archived badge that overrode a manual Frozen status", () => {
    const conflicted = node("goal", {
      status: "frozen", timeScope: { start_id: 1, end_id: 2, duration: { n: 1, kind: "week" } },
      timing: "lapsed", resolution: "missed", archived: true, archivalConflict: true,
    });
    expect(renderRow(conflicted)).toContain("archivedConflict");
  });

  it("uses the habit tooltip for a virtual habit instance and the flow tooltip otherwise", () => {
    const habit = node("task", { status: "todo", habitItem: { flowId: 1, itemType: "flow_root", itemId: 1, scopeId: 5 } });
    expect(renderRow(habit)).toEqual(["habitInstance"]);

    const started = node("task", { status: "todo", fromFlow: true });
    expect(renderRow(started)).toEqual(["flowInstance"]);
  });

  it("shows the raw Details text as the info tooltip", () => {
    const info = node("info", { infoDetails: "a stack trace" });
    expect(renderRow(info)).toEqual(["a stack trace"]);
  });

  it("renders nothing extra for a node with no relevant status", () => {
    expect(renderRow(node("task", { status: "todo" }))).toEqual([]);
  });
});
