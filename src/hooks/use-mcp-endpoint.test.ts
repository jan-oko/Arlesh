import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { useMcpEndpoint } from "@/hooks/use-mcp-endpoint";
import type { McpEndpointStatus } from "@/api/mcp-endpoint";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const FAILED: McpEndpointStatus = {
  listener: { state: "failed", reason: "Address already in use" },
  port: 4747, configured_port: 4747, env_override: null,
};
const LISTENING: McpEndpointStatus = {
  listener: { state: "listening", address: "127.0.0.1:4848" },
  port: 4848, configured_port: 4848, env_override: null,
};

let calls: { command: string; args: unknown }[] = [];
let answers: Record<string, () => Promise<unknown>> = {};

beforeEach(() => {
  calls = [];
  answers = {
    mcp_endpoint_status: () => Promise.resolve(FAILED),
    restart_mcp_endpoint: () => Promise.resolve(LISTENING),
    set_mcp_port: () => Promise.resolve(LISTENING),
  };
  vi.mocked(invoke).mockImplementation((command: string, args?: unknown) => {
    if (command === "open_gesture") return Promise.resolve("gesture");
    if (command === "close_gesture") return Promise.resolve(null);
    calls.push({ command, args });
    const answer = answers[command];
    return answer === undefined ? Promise.resolve(null) : answer();
  });
});

describe("useMcpEndpoint", () => {
  it("reads the listener's status on mount", async () => {
    const { result } = renderHook(() => useMcpEndpoint());

    await waitFor(() => expect(result.current.status).toEqual(FAILED));
  });

  it("replaces the status with the one a restart leaves behind", async () => {
    const { result } = renderHook(() => useMcpEndpoint());
    await waitFor(() => expect(result.current.status).toEqual(FAILED));

    await act(() => result.current.restart());

    expect(result.current.status).toEqual(LISTENING);
  });

  it("sends a new port and shows where the listener went", async () => {
    const { result } = renderHook(() => useMcpEndpoint());
    await waitFor(() => expect(result.current.status).not.toBeNull());

    await act(() => result.current.setPort(4848));

    expect(calls).toContainEqual({ command: "set_mcp_port", args: { port: 4848 } });
    expect(result.current.status).toEqual(LISTENING);
  });

  it("keeps the last status and says why when an action fails", async () => {
    answers.set_mcp_port = () => Promise.reject(new Error("could not save the MCP port"));
    const { result } = renderHook(() => useMcpEndpoint());
    await waitFor(() => expect(result.current.status).toEqual(FAILED));

    await act(() => result.current.setPort(4848));

    expect(result.current.error).toContain("could not save the MCP port");
    expect(result.current.status).toEqual(FAILED);
  });
});
