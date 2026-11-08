import { useCallback, useEffect, useState } from "react";
import { fetchAgents, onAgentsChanged } from "@/api/agents";
import type { AgentsOverview } from "@/api/agents";
import { onBoardChanged } from "@/api/board";
import { useSettingsReloadStore } from "@/stores/use-settings-reload-store";
import { agentRowId, AGENTS_SECTION_ID } from "@/utils/agent-anchors";

/** What the top bar needs to know of the agents that are held back. */
export interface AgentLocks {
  /** How many agents are at capacity, for any reason: locked by hand, their account locked, or a
   * plan limit used up until its reset. */
  count: number;
  /** The Settings element to scroll to: the one agent's row, or the Agents section. */
  anchor: string;
  /** When the soonest plan-limit lock lifts by itself (milliseconds since the epoch), or `null`. */
  nextResetAt: number | null;
}

const NONE: AgentLocks = { count: 0, anchor: AGENTS_SECTION_ID, nextResetAt: null };

/** The longest a timer may be set for. */
const MAX_TIMER_MS = 2_147_000_000;

/** The locks in `overview`. Pure, so the rule is tested without a window. */
export function locksOf(overview: AgentsOverview): AgentLocks {
  const held = overview.agents.filter((summary) => summary.at_capacity !== null);
  const [only] = held;
  const anchor = held.length === 1 && only !== undefined ? agentRowId(only.agent.id) : AGENTS_SECTION_ID;
  const resets = held.flatMap((summary) =>
    summary.at_capacity?.kind === "usage_limit" ? [new Date(summary.at_capacity.resets_at).getTime()] : [],
  );
  return { count: held.length, anchor, nextResetAt: resets.length === 0 ? null : Math.min(...resets) };
}

/**
 * The agents at capacity, read from the backend and kept current: once on mount, then on every
 * change to the agents or the board (a reported usage window, a reset, an undo). A failed read
 * leaves the last answer; the indicator must not flicker on a hiccup.
 */
export function useAgentLocks(): AgentLocks {
  const [locks, setLocks] = useState<AgentLocks>(NONE);
  const epoch = useSettingsReloadStore((s) => s.epoch);

  const load = useCallback(async () => {
    try {
      setLocks(locksOf(await fetchAgents()));
    } catch {
      // Keep what the bar last showed.
    }
  }, []);

  useEffect(() => {
    let subscribed = true;
    const stops: Array<() => void> = [];
    const keep = (stop: () => void) => { if (subscribed) stops.push(stop); else stop(); };
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    void onAgentsChanged(() => { void load(); }).then(keep);
    void onBoardChanged(() => { void load(); }).then(keep);
    return () => {
      subscribed = false;
      stops.forEach((stop) => stop());
    };
  }, [load, epoch]);

  // A plan-limit lock lifts at its reset with nothing to announce it: ask again then.
  const { nextResetAt } = locks;
  useEffect(() => {
    if (nextResetAt === null) return undefined;
    const wait = Math.min(Math.max(nextResetAt - Date.now(), 0) + 1000, MAX_TIMER_MS);
    const timer = window.setTimeout(() => { void load(); }, wait);
    return () => window.clearTimeout(timer);
  }, [nextResetAt, load]);

  return locks;
}
