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
    // The first Clear is Check every's; the second, once it is set, is Starting's.
    fireEvent.click(screen.getAllByRole("button", { name: "scopeClear" })[0]!);
    // The Starting field goes with it: there is nothing left to start.
    expect(screen.queryByText("expectation:fieldCheckStarting")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({ checkEvery: null });
  });
});

describe("ExpectationEditorModal — no agent switch", () => {
  it("offers no way to make a wait agentic by hand: agents raise their own through the MCP", () => {
    render(<ExpectationEditorModal node={WAIT} onSave={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "advanced" }));
    expect(screen.queryByText("expectation:agentWaiting")).toBeNull();
  });
});

describe("ExpectationEditorModal — a wait an Asynchronous Task spawned", () => {
  const SPAWNED: MindmapNode = {
    ...WAIT, rowId: "5b1d7c3e-0000-5000-8000-000000000005", origin: { kind: "spawned_wait", task_id: 5 },
  };

  it("offers every field a stored wait's editor does, and saves what was changed", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ExpectationEditorModal node={SPAWNED} allTags={[]} domainNames={new Map()} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("editor:fieldTitle"), { target: { value: "Chase the reviewer" } });
    fireEvent.change(screen.getByLabelText("expectation:fieldCheckEvery"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "expectation:status.released" }));
    fireEvent.click(screen.getByRole("button", { name: "save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0]?.[0]).toMatchObject({
      title: "Chase the reviewer", status: "released", checkEvery: { n: 5, kind: "day" },
    });
  });
});
