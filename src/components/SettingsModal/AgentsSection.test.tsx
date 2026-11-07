import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import AgentsSection from "./AgentsSection";
import {
  applyAgentAction, fetchAgents, issueAgentPin, setAgentAccountLocked,
} from "@/api/agents";
import type { AgentSummary, AgentsOverview } from "@/api/agents";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const bare = key.replace(/^settings:/, "");
      return options === undefined ? bare : `${bare} ${JSON.stringify(options)}`;
    },
  }),
}));

vi.mock("@/wasm/rules", () => ({}));
vi.mock("@/api/agents", () => ({
  fetchAgents: vi.fn(),
  issueAgentPin: vi.fn(),
  applyAgentAction: vi.fn(() => Promise.resolve()),
  setAgentAccountLocked: vi.fn(() => Promise.resolve()),
  onAgentsChanged: vi.fn(() => Promise.resolve(() => undefined)),
}));
vi.mock("@/api/board", () => ({
  onBoardChanged: vi.fn(() => Promise.resolve(() => undefined)),
}));
vi.mock("@/api/mcp-access", () => ({
  fetchMcpAccessCatalogue: vi.fn(() => Promise.resolve({
    roots: [],
    nodes: [
      { node_kind: "goal", node_id: 10, subtype: null, title: "Ship", parent_kind: null,
        parent_id: null, is_private: false, agentic: null },
    ],
    candidates: [],
  })),
  mcpNodeKeyString: (key: { node_kind: string; node_id: number }) => `${key.node_kind}:${key.node_id}`,
}));

function summary(over: Partial<AgentSummary> & { name?: string; status?: "active" | "paused" } = {}): AgentSummary {
  const status = over.status ?? "active";
  return {
    agent: {
      id: 1, name: over.name ?? "writer", account: "work", session_uuid: "s",
      claim: { root: { node_kind: "goal", node_id: 10 }, status, claimed_at: "2026-11-07T09:00:00" },
      locked: false, created_at: "2026-11-07T09:00:00", last_seen_at: null,
    },
    standing: over.standing ?? status,
    at_capacity: over.at_capacity ?? null,
  };
}

function overview(agents: AgentSummary[]): AgentsOverview {
  return { agents, accounts: [{ label: "work", locked: false, windows: [] }] };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchAgents).mockResolvedValue(overview([summary()]));
});

describe("AgentsSection", () => {
  it("says so when no agent has attached", async () => {
    vi.mocked(fetchAgents).mockResolvedValue({ agents: [], accounts: [] });
    render(<AgentsSection />);
    expect(await screen.findByText("mcp.agents.none")).toBeInTheDocument();
  });

  it("lists an agent with its subtree and standing", async () => {
    render(<AgentsSection />);
    const list = await screen.findByRole("list", { name: "mcp.agents.list" });
    expect(within(list).getByText("writer")).toBeInTheDocument();
    expect(within(list).getByText("mcp.agents.standing.active")).toBeInTheDocument();
    expect(within(list).getByText(/Ship/)).toBeInTheDocument();
  });

  it("names why an agent at capacity is held back", async () => {
    vi.mocked(fetchAgents).mockResolvedValue(overview([summary({
      at_capacity: { kind: "usage_limit", window: "five_hour", resets_at: "2099-01-01T00:00:00" },
    })]));
    render(<AgentsSection />);
    expect(await screen.findByText(/mcp\.agents\.capacity\.usage_limit/)).toBeInTheDocument();
  });

  it("pauses an active claim and resumes a paused one", async () => {
    render(<AgentsSection />);
    fireEvent.click(await screen.findByRole("button", { name: /mcp\.agents\.forAgent.*mcp\.agents\.pause/ }));
    expect(applyAgentAction).toHaveBeenCalledWith(1, { action: "pause" });
    expect(screen.queryByRole("button", { name: /mcp\.agents\.resume/ })).toBeNull();
  });

  it("offers resume for a paused claim", async () => {
    vi.mocked(fetchAgents).mockResolvedValue(overview([summary({ status: "paused" })]));
    render(<AgentsSection />);
    fireEvent.click(await screen.findByRole("button", { name: /mcp\.agents\.resume/ }));
    expect(applyAgentAction).toHaveBeenCalledWith(1, { action: "resume" });
  });

  it("releases a claim and locks an agent", async () => {
    render(<AgentsSection />);
    fireEvent.click(await screen.findByRole("button", { name: /mcp\.agents\.release/ }));
    expect(applyAgentAction).toHaveBeenCalledWith(1, { action: "release" });
    fireEvent.click(screen.getByRole("button", { name: /"action":"mcp\.agents\.lock"|mcp\.agents\.lock/ }));
    expect(applyAgentAction).toHaveBeenCalledWith(1, { action: "lock", locked: true });
  });

  it("removes an agent only after confirming", async () => {
    render(<AgentsSection />);
    fireEvent.click(await screen.findByRole("button", { name: /mcp\.agents\.forAgent.*mcp\.agents\.remove/ }));
    expect(applyAgentAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "mcp.agents.removeConfirm" }));
    expect(applyAgentAction).toHaveBeenCalledWith(1, { action: "remove" });
  });

  it("locks an account from its switch", async () => {
    render(<AgentsSection />);
    fireEvent.click(await screen.findByRole("checkbox", { name: /mcp\.agents\.accountLock/ }));
    expect(setAgentAccountLocked).toHaveBeenCalledWith("work", true);
  });

  it("shows a PIN when one is asked for", async () => {
    vi.mocked(issueAgentPin).mockResolvedValue({ pin: "12345678", expires_at: "2026-11-07T10:05:00" });
    render(<AgentsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "mcp.agents.getPin" }));
    expect(await screen.findByText("12345678")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "mcp.agents.pinCopy" })).toBeInTheDocument();
  });

  it("shows a failed change instead of dropping it", async () => {
    vi.mocked(applyAgentAction).mockRejectedValueOnce(new Error("no such agent"));
    render(<AgentsSection />);
    fireEvent.click(await screen.findByRole("button", { name: /mcp\.agents\.release/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("no such agent");
  });

  it("shows a failed PIN request", async () => {
    vi.mocked(issueAgentPin).mockRejectedValueOnce(new Error("too many PINs"));
    render(<AgentsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "mcp.agents.getPin" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("too many PINs");
  });
});
