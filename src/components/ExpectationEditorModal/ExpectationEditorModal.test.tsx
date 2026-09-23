import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MindmapNode } from "@/utils/tree-layout";
import ExpectationEditorModal from "./ExpectationEditorModal";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "ltr" } }) }));

const WAIT: MindmapNode = {
  id: "wait", kind: "expectation", rowId: 3, title: "Reviewer replies", status: "pending",
  checkEvery: { n: 3, kind: "day" }, checkStarting: "2026-07-03T02:00:00", timeScope: null,
  position: 0, tagIds: [], children: [],
};

describe("ExpectationEditorModal — Check every", () => {
  it("clears a set Check every, and the save says so", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ExpectationEditorModal node={WAIT} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "scopeClear" }));
    // The Starting field goes with it: there is nothing left to start.
    expect(screen.queryByLabelText("expectation:fieldCheckStarting")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ checkEvery: null });
  });
});
