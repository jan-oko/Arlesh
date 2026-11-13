import { useCallback } from "react";
import { useAgentLocks } from "@/hooks/use-agent-locks";
import { useAgentActivityStore } from "@/stores/use-agent-activity-store";
import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { useSettingsStore } from "@/stores/use-settings-store";
import { useViewStore } from "@/stores/use-view-store";
import type { AgentActivity } from "@/utils/agent-activity";

/** The agents' status as the top bar draws it, and what its popover can do about each line. */
export interface AgentStatus extends AgentActivity {
  /** Whether any agent is at capacity: locked by hand, its account locked, or a plan limit used up. */
  atCapacity: boolean;
  /** How many agents are at capacity. */
  capacityCount: number;
  /** Whether anything at all applies — the head is drawn only then. */
  isActive: boolean;
  /** Opens Settings on the Agents section, at the agent that is held back when it is only one. */
  openCapacity: () => void;
  /** Shows the Agentic Tasks waiting on the user's Review: the List View under Do, where Review
   * shows first, with the Agentic pill. */
  showReview: () => void;
  /** Shows the pending waits: the List View under its Expectations option. */
  showWaits: () => void;
  /** Shows the Agentic Tasks On Agent: the List View under Do with the On Agent pill on, and the
   * Agentic pill. */
  showOnAgent: () => void;
}

/**
 * The top bar's agent status: the agents held back by a lock, and the agents' activity on the whole
 * board as the latest load counted it. Live through both — a lock change arrives as the agents'
 * own event and as a board reload, and every other change as a reload.
 */
export function useAgentStatus(): AgentStatus {
  const locks = useAgentLocks();
  const showSettings = useSettingsStore((s) => s.show);
  const activity = useAgentActivityStore((s) => s.activity);
  const setView = useViewStore((s) => s.setView);
  const setStatusMode = useFilterStore((s) => s.setStatusMode);
  const toggleShowOnAgent = useFilterStore((s) => s.toggleShowOnAgent);
  const setListPreset = useListFilterStore((s) => s.setPreset);
  const addPill = useListFilterStore((s) => s.addPill);

  const openCapacity = useCallback(
    () => showSettings("mcp", locks.anchor),
    [showSettings, locks.anchor],
  );
  const showWaits = useCallback(() => {
    setView("list");
    setListPreset("expectations");
  }, [setView, setListPreset]);
  const showReview = useCallback(() => {
    setView("list");
    setStatusMode("do");
    setListPreset("do");
    addPill("agentic", "agentic", "all");
  }, [setView, setStatusMode, setListPreset, addPill]);
  const showOnAgent = useCallback(() => {
    showReview();
    if (useFilterStore.getState().filter.showOnAgent !== true) toggleShowOnAgent();
  }, [showReview, toggleShowOnAgent]);

  const atCapacity = locks.count > 0;
  const isActive = atCapacity || activity.review + activity.waits + activity.onAgent > 0;
  return { ...activity, atCapacity, capacityCount: locks.count, isActive, openCapacity, showReview, showWaits, showOnAgent };
}
