import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import OccurrenceEditorModal from "./OccurrenceEditorModal";
import type { MindmapNode } from "@/utils/tree-layout";
import type { TimeScope } from "@/api/time-scope";
import type { FlowItemOption } from "@/hooks/use-occurrence-editor";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "ltr" } }),
}));
vi.mock("@/hooks/use-scope-range-label", () => ({ useScopeRangeLabel: () => "Tue" }));
vi.mock("@/hooks/use-input-capture", () => ({ useInputCapture: () => undefined }));

const saturday: TimeScope = { start_id: 16, end_id: 16 };

// The Plan field is the Task editor's own, tested on its own; here it only has to hand a window
// back, or clear one.
vi.mock("@/components/ScopePicker/PlanField", () => ({
  default: ({ onChange }: { onChange: (plan: TimeScope | null) => void }) => (
    <div>
      <button type="button" data-testid="pick-saturday" onClick={() => onChange(saturday)} />
      <button type="button" data-testid="clear-plan" onClick={() => onChange(null)} />
    </div>
  ),
}));

const tuesday: TimeScope = { start_id: 12, end_id: 12 };
const shop = { item_type: "flow_task" as const, item_id: 6 };
const CANDIDATES: FlowItemOption[] = [{ ref: shop, title: "Shop" }];
const META = { templateTitle: "Groceries", ownTitle: null, blockedReason: null, dependsOn: [], archived: false };

function occurrence(extra: Partial<MindmapNode> = {}): MindmapNode {
  return {
    id: "habititem-flow_task-7-2-0-virtual", kind: "task", title: "Groceries", position: 0,
    tagIds: [], children: [], virtual: true,
    habitItem: { flowId: 3, itemType: "flow_task", itemId: 7, scopeId: 100, cycleId: 2 },
    plan: tuesday, cyclePlan: tuesday, planOverridden: false, occurrence: META,
    ...extra,
  };
}

function renderModal(node: MindmapNode) {
  const onSave = vi.fn((..._args: unknown[]) => Promise.resolve());
  const onSetArchived = vi.fn((..._args: unknown[]) => Promise.resolve());
  render(
    <OccurrenceEditorModal
      node={node} candidates={CANDIDATES} onSave={onSave} onSetArchived={onSetArchived} onClose={vi.fn()}
    />,
  );
  return { onSave, onSetArchived };
}

const save = () => fireEvent.click(screen.getByRole("button", { name: "save" }));
const option = (name: string) => screen.getByRole("radio", { name: `occurrence.plan.${name}` });
const saved = (onSave: ReturnType<typeof renderModal>["onSave"]) => onSave.mock.calls[0]?.[0];

describe("OccurrenceEditorModal", () => {
  it("opens on the state the occurrence is in", () => {
    renderModal(occurrence({ plan: null, planOverridden: true }));
    expect(option("unplanned")).toHaveAttribute("aria-checked", "true");
    expect(option("inherit")).toHaveAttribute("aria-checked", "false");
  });

  it("saves a title and a block reason typed for this occurrence", async () => {
    const { onSave } = renderModal(occurrence());
    fireEvent.change(screen.getByRole("textbox", { name: "fieldTitle" }), { target: { value: "Groceries for four" } });
    fireEvent.change(screen.getByRole("textbox", { name: "occurrence.blockReason" }), { target: { value: "shop shut" } });
    save();
    await waitFor(() => expect(saved(onSave)).toMatchObject({ title: "Groceries for four", blockedReason: "shop shut" }));
  });

  it("plans the occurrence into the window picked with the Task's Plan field", async () => {
    const { onSave } = renderModal(occurrence());
    fireEvent.click(option("planned"));
    fireEvent.click(screen.getByTestId("pick-saturday"));
    save();
    await waitFor(() => expect(saved(onSave)).toMatchObject({ plan: { kind: "planned", plan: saturday } }));
  });

  it("hands an overridden occurrence back to its Cycle Plan", async () => {
    const { onSave } = renderModal(occurrence({ plan: saturday, planOverridden: true }));
    fireEvent.click(option("inherit"));
    save();
    await waitFor(() => expect(saved(onSave)).toMatchObject({ plan: { kind: "inherit" } }));
  });

  it("reads the Plan field's Clear as leaving this occurrence unplanned", async () => {
    const { onSave } = renderModal(occurrence({ plan: saturday, planOverridden: true }));
    fireEvent.click(screen.getByTestId("clear-plan"));
    expect(option("unplanned")).toHaveAttribute("aria-checked", "true");
    save();
    await waitFor(() => expect(saved(onSave)).toMatchObject({ plan: { kind: "unplanned" } }));
  });

  it("makes this occurrence wait on another item of the habit", async () => {
    const { onSave } = renderModal(occurrence());
    fireEvent.click(screen.getByRole("checkbox", { name: "Shop" }));
    save();
    await waitFor(() => expect(saved(onSave)).toMatchObject({ dependsOn: [shop] }));
  });

  it("asks for a window rather than saving 'plan this occurrence' with none", () => {
    const { onSave } = renderModal(occurrence());
    fireEvent.click(option("planned"));
    save();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("occurrence.pickAPlan")).toBeInTheDocument();
  });

  it("shows neither a Plan nor dependencies for a goal occurrence", () => {
    renderModal(occurrence({ kind: "goal" }));
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("deletes the occurrence from its iteration", async () => {
    const live = renderModal(occurrence());
    fireEvent.click(screen.getByRole("button", { name: "occurrence.delete" }));
    await waitFor(() => expect(live.onSetArchived).toHaveBeenCalledWith(true));
  });

  it("restores a deleted occurrence", async () => {
    const gone = renderModal(occurrence({ occurrence: { ...META, archived: true } }));
    fireEvent.click(screen.getByRole("button", { name: "occurrence.restore" }));
    await waitFor(() => expect(gone.onSetArchived).toHaveBeenCalledWith(false));
  });

  it("shows a refusal from the backend and stays open", async () => {
    const onSave = vi.fn(() => Promise.reject(new Error("plan is not within the occurrence's window")));
    render(
      <OccurrenceEditorModal
        node={occurrence()} candidates={CANDIDATES} onSave={onSave} onSetArchived={vi.fn()} onClose={vi.fn()}
      />,
    );
    fireEvent.click(option("unplanned"));
    save();
    await waitFor(() =>
      expect(screen.getByText("plan is not within the occurrence's window")).toBeInTheDocument(),
    );
  });
});
