import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import InfoEditorModal from "./InfoEditorModal";
import type { MindmapNode } from "@/utils/tree-layout";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "ltr" } }),
}));

function mkInfo(overrides: Partial<MindmapNode> = {}): MindmapNode {
  return { id: "info-1", kind: "info", title: "Crash on save", position: 0, tagIds: [], children: [], ...overrides };
}

const defaultProps = { node: mkInfo(), onSave: vi.fn().mockResolvedValue(undefined), onClose: vi.fn() };

beforeEach(() => { vi.clearAllMocks(); });

describe("InfoEditorModal", () => {
  it("pre-fills the body and details from the node", () => {
    render(<InfoEditorModal {...defaultProps} node={mkInfo({ infoDetails: "traceback line 1" })} />);
    expect(screen.getByDisplayValue("Crash on save")).toBeInTheDocument();
    expect(screen.getByDisplayValue("traceback line 1")).toBeInTheDocument();
  });

  it("saves the edited body and details", async () => {
    render(<InfoEditorModal {...defaultProps} />);
    fireEvent.change(screen.getByDisplayValue("Crash on save"), { target: { value: "Crash on load" } });
    fireEvent.change(screen.getByRole("textbox", { name: "fieldDetails" }), { target: { value: "  stack\ntrace  " } });
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() =>
      expect(defaultProps.onSave).toHaveBeenCalledWith({ body: "Crash on load", details: "  stack\ntrace  ", nsfw: false }),
    );
  });

  it("saves null details when the field is left empty", async () => {
    render(<InfoEditorModal {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(defaultProps.onSave).toHaveBeenCalledWith({ body: "Crash on save", details: null, nsfw: false }));
  });
});
