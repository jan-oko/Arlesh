import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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
    fireEvent.click(screen.getByRole("button", { name: "status:project.paused" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(defaultProps.onSave).toHaveBeenCalledWith(
        expect.objectContaining({ status: "paused" }),
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
