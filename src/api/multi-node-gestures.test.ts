import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { archiveNodes } from "./multi-node-gestures";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(invoke).mockResolvedValue([]);
});

describe("archiveNodes", () => {
  it("runs one archive-nodes gesture whose writes archive each kind", async () => {
    await archiveNodes([
      { kind: "task", id: 1, archive: true },
      { kind: "commitment", id: 2, archive: true },
      { kind: "domain", id: 3, archive: true },
    ]);

    expect(invoke).toHaveBeenCalledWith("run_gesture", {
      name: "archive-nodes",
      steps: [
        { op: "update_task", id: 1, request: { archival: "archived" } },
        { op: "update_commitment", id: 2, request: { archival: "archived" } },
        { op: "update_domain", id: 3, request: { status: "archived" } },
      ],
    });
  });

  it("brings a node back with the live state", async () => {
    await archiveNodes([{ kind: "task", id: 1, archive: false }]);

    expect(invoke).toHaveBeenCalledWith("run_gesture", {
      name: "archive-nodes",
      steps: [{ op: "update_task", id: 1, request: { archival: "live" } }],
    });
  });
});
