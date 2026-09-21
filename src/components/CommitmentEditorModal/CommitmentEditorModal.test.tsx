import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import CommitmentEditorModal from "./CommitmentEditorModal";
import type { MindmapNode } from "@/utils/tree-layout";
import type { Domain } from "@/api/domains";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { dir: () => "ltr" },
  }),
}));

// TimeScopeField resolves scope labels on mount; stub the scope API so scoped-node renders don't
// emit unhandled rejections.
vi.mock("@/api/scopes", () => ({
  getScope: vi.fn().mockResolvedValue({
    id: 1, kind: "day", start_date: "2026-01-05", end_date: "2026-01-05",
    start_datetime: null, end_datetime: null, part: null,
  }),
  getOrCreateScope: vi.fn(),
}));

function mkNode(overrides: Partial<MindmapNode> = {}): MindmapNode {
  return {
    id: "commitment-1",
    kind: "commitment",
    title: "Asleep by 23:00",
    verdict: "unresolved",
    position: 0,
    tagIds: [2],
    children: [],
    ...overrides,
  };
}

function mkTag(id: number, title: string): Domain {
  return { id, title, description: null, subtype: "tag", parent_id: null, color: null, status: null, knowledge_base_directory: null, position: 0, is_private: false };
}

const TAG_A = mkTag(1, "frontend");
const TAG_B = mkTag(2, "urgent");

const defaultProps = {
  node: mkNode(),
  allTags: [TAG_A, TAG_B],
  domainNames: new Map<number, string>(),
  onSave: vi.fn().mockResolvedValue(undefined),
  onClose: vi.fn(),
};

beforeEach(() => { vi.clearAllMocks(); });

describe("CommitmentEditorModal — what it shows", () => {
  it("pre-fills the title from the node", () => {
    render(<CommitmentEditorModal {...defaultProps} />);
    expect(screen.getByDisplayValue("Asleep by 23:00")).toBeInTheDocument();
  });

  it("offers all three verdicts as equal choices rather than a cycling control", () => {
    render(<CommitmentEditorModal {...defaultProps} />);
    for (const verdict of ["unresolved", "kept", "broken"]) {
      expect(screen.getByRole("button", { name: `status:commitment.${verdict}` })).toBeInTheDocument();
    }
  });

  it("omits the fields a Commitment cannot have rather than disabling them", () => {
    render(<CommitmentEditorModal {...defaultProps} />);
    for (const absent of ["fieldPlan", "fieldOnScopeExit", "fieldBlockReasons", "fieldDependencies", "fieldDelegate"]) {
      expect(screen.queryByText(absent)).not.toBeInTheDocument();
    }
  });

  it("shows the issue a linked commitment is tracked as", () => {
    render(<CommitmentEditorModal {...defaultProps} node={mkNode({ beadsId: "Arlesh-cyo" })} />);
    expect(screen.getByText("Arlesh-cyo")).toBeInTheDocument();
  });
});

describe("CommitmentEditorModal — save", () => {
  it("calls onSave with the trimmed title and the node's current fields", async () => {
    render(<CommitmentEditorModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(defaultProps.onSave).toHaveBeenCalledWith({
        title: "Asleep by 23:00",
        verdict: "unresolved",
        tagIds: [2],
        timeScope: null,
        verdictWindow: null,
        isPrivate: false,
      }),
    );
  });

  it("does not call onSave when the title is blank", () => {
    render(<CommitmentEditorModal {...defaultProps} node={mkNode({ title: "   " })} />);
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(defaultProps.onSave).not.toHaveBeenCalled();
  });

  it("records a verdict chosen in the editor", async () => {
    render(<CommitmentEditorModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "status:commitment.broken" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(defaultProps.onSave).toHaveBeenCalledWith(expect.objectContaining({ verdict: "broken" })),
    );
  });

  it("saves a Verdict Window set in its own scope kind", async () => {
    render(<CommitmentEditorModal {...defaultProps} />);
    fireEvent.change(screen.getByLabelText("fieldVerdictWindow"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "kindWeek" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(defaultProps.onSave).toHaveBeenCalledWith(
        expect.objectContaining({ verdictWindow: { n: 2, kind: "week" } }),
      ),
    );
  });

  it("clearing the count goes back to inheriting rather than to never expiring", async () => {
    render(<CommitmentEditorModal {...defaultProps} node={mkNode({ verdictWindow: { n: 3, kind: "day" } })} />);
    fireEvent.change(screen.getByLabelText("fieldVerdictWindow"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(defaultProps.onSave).toHaveBeenCalledWith(expect.objectContaining({ verdictWindow: null })),
    );
  });

  it("stays open and says why when the save is refused", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("commitment has no effective time scope"));
    render(<CommitmentEditorModal {...defaultProps} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(screen.getByText("commitment has no effective time scope")).toBeInTheDocument(),
    );
    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });
});

describe("CommitmentEditorModal — keyboard", () => {
  it("saves when Enter is pressed on the title input", async () => {
    render(<CommitmentEditorModal {...defaultProps} />);
    const input = screen.getByDisplayValue("Asleep by 23:00");
    fireEvent.keyDown(input, { key: "Enter", target: input });
    await waitFor(() => expect(defaultProps.onSave).toHaveBeenCalled());
  });

  it("closes when Escape is pressed", () => {
    render(<CommitmentEditorModal {...defaultProps} />);
    fireEvent.keyDown(screen.getByDisplayValue("Asleep by 23:00"), { key: "Escape" });
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });
});

describe("CommitmentEditorModal — the Issue row", () => {
  it("offers no row at all for a commitment with no issue link", () => {
    render(<CommitmentEditorModal {...defaultProps} onClearBeadsId={vi.fn()} />);
    expect(screen.queryByText("fieldBeadsId")).not.toBeInTheDocument();
  });

  it("stages the clear on the ×: nothing is written until Save", () => {
    const onClearBeadsId = vi.fn().mockResolvedValue(undefined);
    render(
      <CommitmentEditorModal
        {...defaultProps}
        node={mkNode({ beadsId: "Arlesh-5fs" })}
        onClearBeadsId={onClearBeadsId}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "clearBeadsId" }));

    expect(onClearBeadsId).not.toHaveBeenCalled();
    expect(defaultProps.onSave).not.toHaveBeenCalled();
    expect(defaultProps.onClose).not.toHaveBeenCalled();
    // The row reads as dropped and offers no second press, but the id is still there to come back.
    expect(screen.queryByRole("button", { name: "clearBeadsId" })).not.toBeInTheDocument();
    expect(screen.getByText("Arlesh-5fs")).toBeInTheDocument();
  });

  it("discards the staged clear when the editor is cancelled", async () => {
    const onClearBeadsId = vi.fn().mockResolvedValue(undefined);
    render(
      <CommitmentEditorModal
        {...defaultProps}
        node={mkNode({ beadsId: "Arlesh-5fs" })}
        onClearBeadsId={onClearBeadsId}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "clearBeadsId" }));
    fireEvent.click(screen.getByText("cancel"));

    await waitFor(() => expect(defaultProps.onClose).toHaveBeenCalledTimes(1));
    expect(onClearBeadsId).not.toHaveBeenCalled();
  });

  it("performs the staged clear on Save", async () => {
    const onClearBeadsId = vi.fn().mockResolvedValue(undefined);
    render(
      <CommitmentEditorModal
        {...defaultProps}
        node={mkNode({ beadsId: "Arlesh-5fs" })}
        onClearBeadsId={onClearBeadsId}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "clearBeadsId" }));
    fireEvent.click(screen.getByText("save"));

    await waitFor(() => expect(onClearBeadsId).toHaveBeenCalledTimes(1));
    expect(defaultProps.onSave).toHaveBeenCalledTimes(1);
  });

  it("saves without a clear when the × was never pressed", async () => {
    const onClearBeadsId = vi.fn().mockResolvedValue(undefined);
    render(
      <CommitmentEditorModal
        {...defaultProps}
        node={mkNode({ beadsId: "Arlesh-5fs" })}
        onClearBeadsId={onClearBeadsId}
      />,
    );

    fireEvent.click(screen.getByText("save"));

    await waitFor(() => expect(defaultProps.onSave).toHaveBeenCalledTimes(1));
    expect(onClearBeadsId).not.toHaveBeenCalled();
  });
});
