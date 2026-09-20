import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ProjectEditorModal from "./ProjectEditorModal";
import type { MindmapNode } from "@/utils/tree-layout";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { dir: () => "ltr" },
  }),
}));

function mkNode(overrides: Partial<MindmapNode> = {}): MindmapNode {
  return {
    id: "domain-1",
    kind: "project",
    title: "My Project",
    status: "active",
    knowledgeBaseDirectory: "/kb/path",
    position: 0,
    tagIds: [],
    children: [],
    ...overrides,
  };
}

const defaultProps = {
  node: mkNode(),
  onSave: vi.fn().mockResolvedValue(undefined),
  onClose: vi.fn(),
};

beforeEach(() => { vi.clearAllMocks(); });

describe("ProjectEditorModal — initial state", () => {
  it("pre-fills title from node", () => {
    render(<ProjectEditorModal {...defaultProps} />);
    expect(screen.getByDisplayValue("My Project")).toBeInTheDocument();
  });

  it("pre-fills kbDir from node", () => {
    render(<ProjectEditorModal {...defaultProps} />);
    expect(screen.getByDisplayValue("/kb/path")).toBeInTheDocument();
  });
});

describe("ProjectEditorModal — save", () => {
  it("calls onSave with trimmed title and kbDir", async () => {
    render(<ProjectEditorModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(defaultProps.onSave).toHaveBeenCalledWith({
        title: "My Project",
        status: "active",
        knowledgeBaseDirectory: "/kb/path",
        isPrivate: false,
      }),
    );
  });

  it("does not call onSave when title is empty", () => {
    render(<ProjectEditorModal {...defaultProps} node={mkNode({ title: "" })} />);
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    expect(defaultProps.onSave).not.toHaveBeenCalled();
  });

  it("calls onSave with updated status after clicking a status pill", async () => {
    render(<ProjectEditorModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "status:project.achieved" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(defaultProps.onSave).toHaveBeenCalledWith(
        expect.objectContaining({ status: "achieved" }),
      ),
    );
  });
});

describe("ProjectEditorModal — cancel", () => {
  it("calls onClose when Escape is pressed on the title input", () => {
    render(<ProjectEditorModal {...defaultProps} />);
    const inputs = screen.getAllByRole("textbox");
    fireEvent.keyDown(inputs[0]!, { key: "Escape" });
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when cancel button is clicked", () => {
    render(<ProjectEditorModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ProjectEditorModal — bd issue link", () => {
  it("shows the issue a linked project is tracked as", () => {
    render(<ProjectEditorModal {...defaultProps} node={mkNode({ beadsId: "Arlesh-5fs" })} />);
    expect(screen.getByText("Arlesh-5fs")).toBeInTheDocument();
  });

  it("shows no issue row at all for an unlinked project", () => {
    render(<ProjectEditorModal {...defaultProps} node={mkNode()} />);
    expect(screen.queryByText("fieldBeadsId")).not.toBeInTheDocument();
  });
});

/*
 * Escape is handled by a React `onKeyDown` on the dialog element, so it only fires while focus is
 * already inside the dialog. These press it with no Tab and no click first — the state the modal is
 * actually in the instant it opens — which is the one case a `fireEvent.keyDown` aimed at the input
 * cannot show.
 */
describe("ProjectEditorModal — focus on open", () => {
  it("puts focus inside the dialog when it opens", () => {
    render(<ProjectEditorModal {...defaultProps} />);
    expect(screen.getByLabelText("fieldTitle")).toHaveFocus();
  });

  it("closes on an Escape pressed the moment it opens, with no Tab or click first", async () => {
    const user = userEvent.setup();
    render(<ProjectEditorModal {...defaultProps} />);
    await user.keyboard("{Escape}");
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ProjectEditorModal — the Issue row", () => {
  it("offers no row at all for a project with no issue link", () => {
    render(<ProjectEditorModal {...defaultProps} onClearBeadsId={vi.fn()} />);
    expect(screen.queryByText("fieldBeadsId")).not.toBeInTheDocument();
  });

  it("drops the link from the × without touching the save", async () => {
    const onClearBeadsId = vi.fn().mockResolvedValue(undefined);
    render(
      <ProjectEditorModal
        {...defaultProps}
        node={mkNode({ beadsId: "Arlesh-5fs" })}
        onClearBeadsId={onClearBeadsId}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "clearBeadsId" }));

    await waitFor(() => expect(onClearBeadsId).toHaveBeenCalledTimes(1));
    expect(defaultProps.onSave).not.toHaveBeenCalled();
    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });
});
