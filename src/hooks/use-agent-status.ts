import { useCallback } from "react";
import { useAgentCapacity } from "@/hooks/use-agent-capacity";
import { useAgentActivityStore } from "@/stores/use-agent-activity-store";
import { useFilterStore } from "@/stores/use-filter-store";
import { useListFilterStore } from "@/stores/use-list-filter-store";
import { useViewStore } from "@/stores/use-view-store";
import type { AgentActivity } from "@/utils/agent-activity";

/** The agents' status as the top bar draws it, and what its popover can do about each line. */
export interface AgentStatus extends AgentActivity {
  /** Whether the agent capacity lock is on. */
  atCapacity: boolean;
  /** Whether anything at all applies — the head is drawn only then. */
  isActive: boolean;
  /** Clears the agent capacity lock. */
  clearCapacity: () => void;
  /** Shows the pending waits: the List View under its Expectations option. */
  showWaits: () => void;
  /** Shows the Agentic Tasks In Progress: the List View under Do, with the Agentic pill. */
  showInProgress: () => void;
}

/**
 * The top bar's agent status: the capacity lock, and the agents' activity on the whole board as the
 * latest load counted it. Live through both — a lock flip arrives as its own event and as a board
 * reload, and every other change as a reload.
 */
export function useAgentStatus(): AgentStatus {
  const { atCapacity, setAtCapacity } = useAgentCapacity();
  const activity = useAgentActivityStore((s) => s.activity);
  const setView = useViewStore((s) => s.setView);
  const setStatusMode = useFilterStore((s) => s.setStatusMode);
  const setListPreset = useListFilterStore((s) => s.setPreset);
  const addPill = useListFilterStore((s) => s.addPill);

  const clearCapacity = useCallback(() => { void setAtCapacity(false); }, [setAtCapacity]);
  const showWaits = useCallback(() => {
    setView("list");
    setListPreset("expectations");
  }, [setView, setListPreset]);
  const showInProgress = useCallback(() => {
    setView("list");
    setStatusMode("do");
    setListPreset("do");
    addPill("agentic", "agentic", "all");
  }, [setView, setStatusMode, setListPreset, addPill]);

  const isActive = atCapacity || activity.questions + activity.waits + activity.inProgress > 0;
  return { ...activity, atCapacity, isActive, clearCapacity, showWaits, showInProgress };
}
