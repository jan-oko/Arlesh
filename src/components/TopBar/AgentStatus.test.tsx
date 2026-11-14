import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import AgentStatus from "./AgentStatus";
import { fetchAgents } from "@/api/agents";
import type { AgentSummary } from "@/api/agents";
import { useAgentActivityStore } from "@/stores/use-agent-activity-store";
import { NO_AGENT_ACTIVITY } from "@/utils/agent-activity";
import type { AgentActivity } from "@/utils/agent-activity";
import { useViewStore } from "@/stores/use-view-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { useFilterStore } from "@/stores/use-filter-store";
import { useDisplayStore } from "@/stores/use-display-store";
import { useSettingsStore } from "@/stores/use-settings-store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
  }),
}));

vi.mock("@/api/agents", () => ({
  fetchAgents: vi.fn(),
  onAgentsChanged: vi.fn(() => Promise.resolve(() => undefined)),
}));
vi.mock("@/api/board", () => ({
  onBoardChanged: vi.fn(() => Promise.resolve(() => undefined)),
}));

type Cause = AgentSummary["at_capacity"];

function agent(id: number, cause: Cause): AgentSummary {
  return {
    agent: {
      id, name: `agent-${id}`, account: "work", session_uuid: "s", claim: null, locked: false,
      created_at: "2026-11-07T09:00:00", last_seen_at: null, parent_id: null,
    },
    standing: "unclaimed",
    at_capacity: cause,
  };
}

/** `held` agents at capacity (by hand, for the first), and the board's agent activity. */
function given(held: number, activity: Partial<AgentActivity> = {}): void {
  const agents = Array.from({ length: held }, (_, index) => agent(index + 1, { kind: "agent_locked" }));
  vi.mocked(fetchAgents).mockResolvedValue({ agents, accounts: [] });
  useAgentActivityStore.setState({ activity: { ...NO_AGENT_ACTIVITY, ...activity } });
}

/** Lets the overview read settle. */
async function flush(): Promise<void> {
  await act(async () => {
    await vi.waitFor(() => expect(fetchAgents).toHaveBeenCalled());
    await Promise.resolve();
    await Promise.resolve();
  });
}

function glyphs(): string[] {
  return Array.from(document.querySelectorAll("[data-glyph]")).map((svg) => svg.getAttribute("data-glyph") ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  useDisplayStore.setState({ showAgentStatus: true });
  useSettingsStore.setState({ isOpen: false, page: "general", anchor: null });
});

describe("AgentStatus", () => {
  it("draws no head while nothing applies", async () => {
    given(0);
    render(<AgentStatus />);
    await flush();

    expect(screen.queryByRole("button")).toBeNull();
    expect(glyphs()).toEqual([]);
  });

  it.each([
    ["an agent at capacity", 1, {}, "capacity"],
    ["a task waiting for review", 0, { review: 1 }, "question"],
    ["another agent wait", 0, { waits: 1 }, "wait"],
    ["Agentic work On Agent", 0, { onAgent: 1 }, "on-agent"],
  ] as const)("with only %s, draws the head and that one icon", async (_name, held, activity, glyph) => {
    given(held, activity);
    render(<AgentStatus />);
    await flush();

    expect(glyphs()).toEqual(["head", glyph]);
  });

  it("orders the row capacity, review, waits, on agent, and spells out the counts", async () => {
    given(2, { review: 1, waits: 2, onAgent: 3 });
    render(<AgentStatus />);
    await flush();

    expect(glyphs()).toEqual(["head", "capacity", "question", "wait", "on-agent"]);
    expect(screen.getByRole("button").getAttribute("title")).toBe(
      "agentStatus.capacity:2 agentStatus.review:1 agentStatus.waits:2 agentStatus.onAgent:3 agentStatus.details",
    );
    expect(screen.getByRole("button", { name: /agentStatus\.review:1/ })).toBeDefined();
  });

  it("opens a menu whose Open line shows Settings on the Agents section", async () => {
    given(2, { waits: 1 });
    render(<AgentStatus />);
    await flush();

    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("menu")).toBeDefined();
    fireEvent.click(screen.getByRole("menuitem", { name: "agentStatus.open: agentStatus.capacity:2" }));

    expect(useSettingsStore.getState()).toMatchObject({ isOpen: true, page: "mcp", anchor: "settings-agents" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("points the Open line at the one agent that is held back", async () => {
    given(1);
    render(<AgentStatus />);
    await flush();

    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("menuitem", { name: "agentStatus.open: agentStatus.capacity:1" }));

    expect(useSettingsStore.getState().anchor).toBe("settings-agent-1");
  });

  it("shows the padlock for a derived lock too, not only one set by hand", async () => {
    vi.mocked(fetchAgents).mockResolvedValue({
      agents: [agent(1, { kind: "usage_limit", window: "five_hour", resets_at: "2999-01-01T00:00:00" })],
      accounts: [],
    });
    useAgentActivityStore.setState({ activity: NO_AGENT_ACTIVITY });
    render(<AgentStatus />);
    await flush();

    expect(glyphs()).toEqual(["head", "capacity"]);
  });

  it("shows the waits in the List View's Expectations option", async () => {
    given(0, { waits: 2 });
    render(<AgentStatus />);
    await flush();

    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("menuitem", { name: "agentStatus.show: agentStatus.waits:2" }));

    expect(useViewStore.getState().view).toBe("list");
    expect(useListFilterStore.getState().filter.preset).toBe("expectations");
  });

  it("shows the tasks waiting for review in the List View under Do with the Agentic pill", async () => {
    given(0, { review: 1 });
    render(<AgentStatus />);
    await flush();

    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("menuitem", { name: "agentStatus.show: agentStatus.review:1" }));

    expect(useViewStore.getState().view).toBe("list");
    expect(useFilterStore.getState().filter.statusMode).toBe("do");
    expect(useListFilterStore.getState().filter.pills.agentic).toEqual([{ value: "agentic", mode: "all" }]);
  });

  it("shows Agentic work On Agent under Do with the On Agent pill on", async () => {
    useFilterStore.setState((s) => ({ filter: { ...s.filter, showOnAgent: false } }));
    given(0, { onAgent: 1 });
    render(<AgentStatus />);

    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("menuitem", { name: "agentStatus.show: agentStatus.onAgent:1" }));

    expect(useFilterStore.getState().filter.statusMode).toBe("do");
    expect(useFilterStore.getState().filter.showOnAgent).toBe(true);
  });

  it("closes the menu on Escape", async () => {
    given(1);
    render(<AgentStatus />);
    await flush();

    fireEvent.click(screen.getByRole("button"));
    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("draws no head with its setting off, even with the lock on and waits pending", async () => {
    given(1, { review: 1, waits: 1, onAgent: 1 });
    useDisplayStore.setState({ showAgentStatus: false });
    render(<AgentStatus />);
    await flush();

    expect(screen.queryByRole("button")).toBeNull();
    expect(glyphs()).toEqual([]);
  });
});
