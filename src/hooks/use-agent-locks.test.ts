import { describe, it, expect } from "vitest";
import { locksOf } from "./use-agent-locks";
import type { AgentSummary, AgentsOverview } from "@/api/agents";

function agent(id: number, cause: AgentSummary["at_capacity"], parent: number | null = null): AgentSummary {
  return {
    agent: {
      id, name: `a${id}`, account: "work", session_uuid: "s", claim: null, locked: false,
      created_at: "2026-11-07T09:00:00", last_seen_at: null, parent_id: parent,
    },
    standing: "unclaimed",
    at_capacity: cause,
  };
}

function overview(...agents: AgentSummary[]): AgentsOverview {
  return { agents, accounts: [] };
}

describe("locksOf", () => {
  it("counts no agent with room", () => {
    expect(locksOf(overview(agent(1, null))).count).toBe(0);
  });

  it.each([
    ["locked by hand", { kind: "agent_locked" } as const],
    ["its account locked", { kind: "account_locked" } as const],
    ["a plan limit used up", { kind: "usage_limit", window: "five_hour", resets_at: "2999-01-01T00:00:00" } as const],
  ])("counts an agent held back by %s", (_name, cause) => {
    expect(locksOf(overview(agent(1, cause))).count).toBe(1);
  });

  it("points at the one agent that is held back, and at the section when there are several", () => {
    expect(locksOf(overview(agent(1, null), agent(2, { kind: "agent_locked" }))).anchor).toBe("settings-agent-2");
    expect(locksOf(overview(agent(1, { kind: "agent_locked" }), agent(2, { kind: "account_locked" }))).anchor)
      .toBe("settings-agents");
  });

  it("counts a locked parent once, however many children it has", () => {
    const locked = { kind: "agent_locked" } as const;
    const held = locksOf(overview(agent(1, locked), agent(2, locked, 1), agent(3, locked, 1)));
    expect(held.count).toBe(1);
    expect(held.anchor).toBe("settings-agent-1");
  });

  it("knows when the soonest plan limit lifts", () => {
    const soon = "2030-01-01T00:00:00";
    const later = "2031-01-01T00:00:00";
    const locks = locksOf(overview(
      agent(1, { kind: "usage_limit", window: "five_hour", resets_at: later }),
      agent(2, { kind: "usage_limit", window: "five_hour", resets_at: soon }),
      agent(3, { kind: "agent_locked" }),
    ));
    expect(locks.nextResetAt).toBe(new Date(soon).getTime());
  });
});
