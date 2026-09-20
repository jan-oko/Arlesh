import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { mockCommandOnce, mockGestureProtocol } from "@/test/command-mock";
import { listDomains, createDomain, updateDomain, deleteDomain } from "./domains";
import type { Domain, CreateDomainRequest } from "./domains";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const mockDomain: Domain = {
  id: 1, title: "Work", description: null, subtype: "aspect",
  parent_id: null, color: "#ff0000", status: null, knowledge_base_directory: null, position: 0, is_private: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGestureProtocol();
});

describe("listDomains", () => {
  it("calls invoke with list_domains and null subtype when no filter given", async () => {
    mockCommandOnce([mockDomain]);
    const result = await listDomains();
    expect(invoke).toHaveBeenCalledWith("list_domains", { subtype: null });
    expect(result).toEqual([mockDomain]);
  });

  it("passes subtype filter to invoke when provided", async () => {
    mockCommandOnce([]);
    await listDomains("tag");
    expect(invoke).toHaveBeenCalledWith("list_domains", { subtype: "tag" });
  });
});

describe("createDomain", () => {
  it("calls invoke with create_domain and wraps the request", async () => {
    mockCommandOnce(mockDomain);
    const req: CreateDomainRequest = {
      title: "Work", description: null, subtype: "aspect",
      parent_id: null, status: null, knowledge_base_directory: null,
    };
    const result = await createDomain(req);
    expect(invoke).toHaveBeenCalledWith("create_domain", { request: req });
    expect(result).toEqual(mockDomain);
  });
});

describe("updateDomain", () => {
  it("calls invoke with update_domain, the id, and the partial request", async () => {
    const updated = { ...mockDomain, title: "Personal" };
    mockCommandOnce(updated);
    const result = await updateDomain(1, { title: "Personal" });
    expect(invoke).toHaveBeenCalledWith("update_domain", { id: 1, request: { title: "Personal" } });
    expect(result.title).toBe("Personal");
  });
});

describe("deleteDomain", () => {
  it("calls invoke with delete_domain and the id", async () => {
    mockCommandOnce(undefined);
    await deleteDomain(7);
    expect(invoke).toHaveBeenCalledWith("delete_domain", { id: 7 });
  });
});
