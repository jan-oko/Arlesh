import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import StartFlowModal from "./StartFlowModal";
import type { MindmapNode } from "@/utils/tree-layout";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "ltr" } }),
}));

// The target filter is exercised in the hook's own tests; here it defaults to unrestricted (null),
// with individual tests overriding it to drive the out-of-scope path.
vi.mock("@/hooks/use-valid-flow-targets", () => ({ useValidFlowTargets: vi.fn(() => null) }));

import { useValidFlowTargets } from "@/hooks/use-valid-flow-targets";

function mkGoal(id: number, title: string): MindmapNode {
  return { id: `goal-${id}`, kind: "goal", title, status: "active", position: 0, tagIds: [], children: [] };
}

const TARGETS = [mkGoal(7, "Backend"), mkGoal(8, "Frontend")];

const defaultProps = {
  flowTitle: "Add Feature",
  flowScoped: true,
  durationN: 2,
  durationKind: "week",
  defaultTargetType: "goal",
  defaultTargetId: 7,
  availableTargets: TARGETS,
  onStart: vi.fn().mockResolvedValue(undefined),
  onClose: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useValidFlowTargets).mockReturnValue(null);
});

describe("StartFlowModal", () => {
  it("pre-fills the title and the flow's default target", () => {
    render(<StartFlowModal {...defaultProps} />);
    expect(screen.getByDisplayValue("Add Feature")).toBeInTheDocument();
    expect(screen.getByText("Backend")).toBeInTheDocument();
  });

  it("shows an anchor date field only for a scoped flow", () => {
    const { rerender } = render(<StartFlowModal {...defaultProps} />);
    expect(screen.getByText("fieldAnchor")).toBeInTheDocument();
    rerender(<StartFlowModal {...defaultProps} flowScoped={false} />);
    expect(screen.queryByText("fieldAnchor")).not.toBeInTheDocument();
  });

  it("starts with the chosen title, target, and anchor", async () => {
    render(<StartFlowModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(defaultProps.onStart).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Add Feature", targetType: "goal", targetId: 7 }),
      ),
    );
  });

  it("allows exactly one target — hides the search once chosen, restores it on removal", () => {
    render(<StartFlowModal {...defaultProps} />);
    // A default target is set → the search box is hidden.
    expect(screen.queryByPlaceholderText("placeholderTargetSearch")).not.toBeInTheDocument();
    // Removing it brings the search back.
    fireEvent.click(screen.getByRole("button", { name: "×" }));
    expect(screen.getByPlaceholderText("placeholderTargetSearch")).toBeInTheDocument();
  });

  it("does not start without a target", () => {
    render(<StartFlowModal {...defaultProps} defaultTargetType={null} defaultTargetId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(defaultProps.onStart).not.toHaveBeenCalled();
  });

  it("blocks starting and warns when the chosen target is out of scope", () => {
    // Only Frontend (goal-8) is valid; the pre-filled default Backend (goal-7) is not.
    vi.mocked(useValidFlowTargets).mockReturnValue(new Set(["goal-8"]));
    render(<StartFlowModal {...defaultProps} />);
    expect(screen.getByText("targetOutOfScope")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(defaultProps.onStart).not.toHaveBeenCalled();
  });

  it("selects a target from the search", async () => {
    render(<StartFlowModal {...defaultProps} defaultTargetType={null} defaultTargetId={null} />);
    fireEvent.change(screen.getByPlaceholderText("placeholderTargetSearch"), { target: { value: "front" } });
    fireEvent.mouseDown(screen.getByText("Frontend"));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(defaultProps.onStart).toHaveBeenCalledWith(expect.objectContaining({ targetType: "goal", targetId: 8 })),
    );
  });
});
