import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listInfos, createInfo, updateInfo, deleteInfo } from "./infos";
import type { Info, CreateInfoRequest } from "./infos";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockInfo: Info = {
  id: 1, body: "Remember to update docs", details: null, parent_type: "task", parent_id: 3, position: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listInfos", () => {
  it("calls invoke with list_infos and returns the info array", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([mockInfo]);
    const result = await listInfos();
    expect(invoke).toHaveBeenCalledWith("list_infos");
    expect(result).toEqual([mockInfo]);
  });
});

describe("createInfo", () => {
  it("calls invoke with create_info and wraps the request", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(mockInfo);
    const req: CreateInfoRequest = {
      body: "Remember to update docs", parent_type: "task", parent_id: 3, position: 0,
    };
    const result = await createInfo(req);
    expect(invoke).toHaveBeenCalledWith("create_info", { request: req });
    expect(result).toEqual(mockInfo);
  });
});

describe("updateInfo", () => {
  it("calls invoke with update_info, the id, and the partial request", async () => {
    const updated = { ...mockInfo, body: "Updated note" };
    vi.mocked(invoke).mockResolvedValueOnce(updated);
    const result = await updateInfo(1, { body: "Updated note" });
    expect(invoke).toHaveBeenCalledWith("update_info", { id: 1, request: { body: "Updated note" } });
    expect(result.body).toBe("Updated note");
  });
});

describe("deleteInfo", () => {
  it("calls invoke with delete_info and the id", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);
    await deleteInfo(1);
    expect(invoke).toHaveBeenCalledWith("delete_info", { id: 1 });
  });
});
