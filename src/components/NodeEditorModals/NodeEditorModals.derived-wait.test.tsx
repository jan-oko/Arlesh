import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import NodeEditorModals from "./NodeEditorModals";
import { useNodeEditor } from "@/components/MindmapView/use-node-editor";
import type { MindmapNode } from "@/utils/tree-layout";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "ltr" } }),
}));
// The Task editor looks things up as it opens; nothing here is about what it finds.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue([]) }));
vi.mock("@/api/domains", () => ({ listDomains: vi.fn().mockResolvedValue([]), updateDomain: vi.fn(), DOMAIN_SUBTYPE: { TAG: "tag" } }));
vi.mock("@/api/flows", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/flows")>()),
  flowOrigins: vi.fn().mockResolvedValue([]),
}));

function node(id: string, kind: MindmapNode["kind"], over: Partial<MindmapNode> = {}): MindmapNode {
  return { id, kind, title: id, position: 0, tagIds: [], children: [], ...over };
}

// A done Asynchronous Task planned into a week, with the wait its completion spawned beneath it,
// beside a stored wait of its own.
const PLAN = { start_id: { kind: "week" as const, date: "2026-09-28" }, end_id: { kind: "week" as const, date: "2026-09-28" } };
const spawned = node("sw-5", "expectation", {
  rowId: "5b1d7c3e-0000-5000-8000-000000000005", title: "Waiting on the reply", status: "pending",
  origin: { kind: "spawned_wait", task_id: 5 }, timeScope: null, checkEvery: null,
});
const task = node("task-5", "task", {
  rowId: 5, title: "Send the email", status: "done", asynchronous: true, plan: PLAN, children: [spawned],
});
const stored = node("wait-3", "expectation", { rowId: 3, title: "Stored wait", status: "pending", timeScope: null, checkEvery: null });
// A delegated Task's wait, drawn with a label round its Task's title.
const delegation = node("dw-6", "expectation", {
  rowId: "6c2e8d4f-0000-5000-8000-000000000006", title: "“Review the PR” done by its delegate", rowTitle: "Review the PR",
  status: "pending", origin: { kind: "delegation_wait", task_id: 6 }, timeScope: null, checkEvery: null,
});
const delegated = node("task-6", "task", { rowId: 6, title: "Review the PR", status: "todo", children: [delegation] });
const tree = node("root", "domain", { children: [task, stored, delegated] });

/** A view's editor wiring, as the Mindmap, List and Steps views have it: `E` calls `onDoubleClick`. */
function Harness() {
  const editor = useNodeEditor({ tree, allTasksAndGoals: [], reload: vi.fn().mockResolvedValue(undefined) });
  return (
    <>
      {[spawned, task, stored, delegation].map((n) => (
        <button key={n.id} type="button" onClick={() => editor.onDoubleClick(n.id)}>{`open ${n.id}`}</button>
      ))}
      <NodeEditorModals tree={tree} editor={editor} />
    </>
  );
}

describe("E on a wait — which editor opens", () => {
  it("opens the full Expectation editor on a spawned wait, with no Plan from its Task", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "open sw-5" }));
    expect(screen.getByRole("heading", { name: "expectation:editHeading" })).toBeInTheDocument();
    // Every field a stored wait's editor offers, each its own to change.
    const title = screen.getByLabelText("editor:fieldTitle");
    expect(title).toHaveValue("Waiting on the reply");
    expect(title).not.toHaveAttribute("readonly");
    expect(screen.getByLabelText("expectation:fieldCheckEvery")).toBeEnabled();
    expect(screen.getByText("editor:fieldTimeScope")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "expectation:status.released" })).toBeEnabled();
    expect(screen.queryByText("editor:fieldPlan")).toBeNull();
    expect(screen.queryByRole("heading", { name: "editTask" })).toBeNull();
  });

  it("opens the Expectation editor on a delegation wait, on its title rather than its label", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "open dw-6" }));
    expect(screen.getByRole("heading", { name: "expectation:editHeading" })).toBeInTheDocument();
    expect(screen.getByLabelText("editor:fieldTitle")).toHaveValue("Review the PR");
  });

  it("opens the Expectation editor on a stored wait", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "open wait-3" }));
    expect(screen.getByRole("heading", { name: "expectation:editHeading" })).toBeInTheDocument();
    expect(screen.getByLabelText("editor:fieldTitle")).toHaveValue("Stored wait");
  });

  it("opens the Task editor on a Task", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "open task-5" }));
    expect(screen.getByRole("heading", { name: "editTask" })).toBeInTheDocument();
  });
});
