import { useEffect } from "react";
import { OPEN_TASK_EVENT, pushBridge } from "@/api/push";
import { activeTabStores } from "@/stores/tab-stores-context";

/**
 * Opens the Task a tapped notification names: the activity hands over its board key (`task-12`) at
 * a cold start and with an event while running, and the active tab selects it.
 */
export function useOpenNotifiedTask(): void {
  useEffect(() => {
    const bridge = pushBridge();
    if (bridge === null) return;
    const open = (): void => {
      const key = bridge.takeOpenedTask();
      if (key !== "") activeTabStores().mindmap.getState().selectNode(key);
    };
    window.addEventListener(OPEN_TASK_EVENT, open);
    open();
    return () => { window.removeEventListener(OPEN_TASK_EVENT, open); };
  }, []);
}
