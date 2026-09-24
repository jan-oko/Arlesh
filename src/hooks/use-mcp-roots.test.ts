import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useMcpRoots } from "@/hooks/use-mcp-roots";
import { useMcpAccessStore } from "@/stores/use-mcp-access-store";
import type { McpAccessCatalogue, McpVisibility } from "@/api/mcp-access";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const CATALOGUE: McpAccessCatalogue = {
  roots: [{ node_kind: "domain", node_id: 2 }],
  nodes: [
    { node_kind: "domain", node_id: 1, subtype: "aspect", title: "Growth", parent_kind: null, parent_id: null, is_private: false, agentic: null },
    { node_kind: "domain", node_id: 2, subtype: "project", title: "Arlesh", parent_kind: "domain", parent_id: 1, is_private: false, agentic: null },
    { node_kind: "goal", node_id: 10, subtype: null, title: "Ship", parent_kind: "domain", parent_id: 2, is_private: false, agentic: null },
  ],
};
const VISIBLE: McpVisibility[] = [
  { node_kind: "domain", node_id: 2, root_kind: "domain", root_id: 2 },
  { node_kind: "goal", node_id: 10, root_kind: "domain", root_id: 2 },
];

let written: { command: string; args: unknown }[] = [];

beforeEach(() => {
  written = [];
  useMcpAccessStore.setState({ revision: 0 });
  vi.mocked(invoke).mockImplementation((command: string, args?: unknown) => {
    if (command === "open_gesture") return Promise.resolve("gesture");
    if (command === "close_gesture") return Promise.resolve(null);
    if (command === "mcp_access_catalogue") return Promise.resolve(CATALOGUE);
    if (command === "list_mcp_access") return Promise.resolve(VISIBLE);
    written.push({ command, args });
    return Promise.resolve(null);
  });
});

describe("useMcpRoots", () => {
  it("lists the roots named and placed, and offers every other node", async () => {
    const { result } = renderHook(() => useMcpRoots());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.roots).toEqual([{
      key: { node_kind: "domain", node_id: 2 }, title: "Arlesh", kind: "project", path: ["Growth"], visible: true,
    }]);
    expect(result.current.candidates.map((candidate) => candidate.title)).toEqual(["Growth", "Ship"]);
  });

  it("adds the node a search result names and tells the views to redraw", async () => {
    const { result } = renderHook(() => useMcpRoots());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const ship = result.current.candidates.find((candidate) => candidate.title === "Ship");

    await act(() => result.current.addRoot(ship?.id ?? ""));

    expect(written).toEqual([{ command: "add_mcp_root", args: { nodeKind: "goal", nodeId: 10 } }]);
    expect(useMcpAccessStore.getState().revision).toBe(1);
  });

  it("removes a root", async () => {
    const { result } = renderHook(() => useMcpRoots());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(() => result.current.removeRoot({ node_kind: "domain", node_id: 2 }));

    expect(written).toEqual([{ command: "remove_mcp_root", args: { nodeKind: "domain", nodeId: 2 } }]);
  });

  it("says why an edit was refused rather than dropping it", async () => {
    vi.mocked(invoke).mockImplementation((command: string) => {
      if (command === "open_gesture") return Promise.resolve("gesture");
      if (command === "close_gesture") return Promise.resolve(null);
      if (command === "mcp_access_catalogue") return Promise.resolve(CATALOGUE);
      if (command === "list_mcp_access") return Promise.resolve(VISIBLE);
      return Promise.reject({ kind: "not_found", message: "goal 10 not found" });
    });
    const { result } = renderHook(() => useMcpRoots());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const ship = result.current.candidates.find((candidate) => candidate.title === "Ship");

    await act(() => result.current.addRoot(ship?.id ?? ""));

    expect(result.current.error).toBe("goal 10 not found");
    expect(useMcpAccessStore.getState().revision).toBe(0);
  });
});
