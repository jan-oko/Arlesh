import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import OccurrencePlanModal from "./OccurrencePlanModal";
import type { MindmapNode } from "@/utils/tree-layout";
import type { TimeScope } from "@/api/time-scope";

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

function occurrence(extra: Partial<MindmapNode> = {}): MindmapNode {
  return {
    id: "habititem-flow_task-7-2-0-virtual", kind: "task", title: "Groceries", position: 0,
    tagIds: [], children: [], virtual: true,
    habitItem: { flowId: 3, itemType: "flow_task", itemId: 7, scopeId: 100, cycleId: 2 },
    plan: tuesday, cyclePlan: tuesday, planOverridden: false,
    ...extra,
  };
}

function renderModal(node: MindmapNode) {
  const onSave = vi.fn((..._args: unknown[]) => Promise.resolve());
  render(<OccurrencePlanModal node={node} onSave={onSave} onClose={vi.fn()} />);
  return onSave;
}

const save = () => fireEvent.click(screen.getByRole("button", { name: "save" }));
const option = (name: string) => screen.getByRole("radio", { name: `occurrencePlan.${name}` });

describe("OccurrencePlanModal", () => {
  it("opens on the state the occurrence is in", () => {
    renderModal(occurrence({ plan: null, planOverridden: true }));
    expect(option("unplanned")).toHaveAttribute("aria-checked", "true");
    expect(option("inherit")).toHaveAttribute("aria-checked", "false");
  });

  it("plans the occurrence into the window picked with the Task's Plan field", async () => {
    const onSave = renderModal(occurrence());
    fireEvent.click(option("planned"));
    fireEvent.click(screen.getByTestId("pick-saturday"));
    save();
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ kind: "planned", plan: saturday }));
  });

  it("hands an overridden occurrence back to its Cycle Plan", async () => {
    const onSave = renderModal(occurrence({ plan: saturday, planOverridden: true }));
    expect(option("planned")).toHaveAttribute("aria-checked", "true");
    fireEvent.click(option("inherit"));
    save();
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ kind: "inherit" }));
  });

  it("leaves the occurrence deliberately unplanned", async () => {
    const onSave = renderModal(occurrence());
    fireEvent.click(option("unplanned"));
    save();
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ kind: "unplanned" }));
  });

  it("reads the Plan field's Clear as leaving this occurrence unplanned", async () => {
    const onSave = renderModal(occurrence({ plan: saturday, planOverridden: true }));
    fireEvent.click(screen.getByTestId("clear-plan"));
    expect(option("unplanned")).toHaveAttribute("aria-checked", "true");
    save();
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ kind: "unplanned" }));
  });

  it("asks for a window rather than saving 'plan this occurrence' with none", () => {
    const onSave = renderModal(occurrence());
    fireEvent.click(option("planned"));
    save();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText("occurrencePlan.pickAPlan")).toBeInTheDocument();
  });

  it("shows a refusal from the backend and stays open", async () => {
    const onSave = vi.fn(() => Promise.reject(new Error("plan is not within the occurrence's window")));
    render(<OccurrencePlanModal node={occurrence()} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.click(option("unplanned"));
    save();
    await waitFor(() =>
      expect(screen.getByText("plan is not within the occurrence's window")).toBeInTheDocument(),
    );
  });
});
