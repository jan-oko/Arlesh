import { useEffect } from "react";
import { OPEN_TASK_EVENT, pushBridge, readOpenedNotification } from "@/api/push";
import { onOpenReview } from "@/api/notifications";
import { activeTabStores } from "@/stores/tab-stores-context";
import { openReviewList } from "@/utils/open-review-list";

/** The channel whose notifications open the Review list (the others open their Task). */
const QUESTION_CHANNEL = "agent_question";

/**
 * Opens what a notification the user acted on asks for.
 *
 * On the phone the activity hands over what a tap named, at a cold start and with an event while
 * running: an agent's question replaces the view with the List View on the Review preset, any
 * other notification selects its Task in the active tab. On the desktop the shell reports a click
 * on a question's notification, which shows a List tab on the Review preset.
 */
export function useOpenNotifiedTask(): void {
  useEffect(() => {
    const bridge = pushBridge();
    if (bridge === null) return;
    const open = (): void => {
      const opened = readOpenedNotification(bridge);
      if (opened === null) return;
      if (opened.channel === QUESTION_CHANNEL) openReviewList({ task: opened.task, wait: opened.wait }, "replace-view");
      else if (opened.task !== null) activeTabStores().mindmap.getState().selectNode(opened.task);
    };
    window.addEventListener(OPEN_TASK_EVENT, open);
    open();
    return () => { window.removeEventListener(OPEN_TASK_EVENT, open); };
  }, []);

  useEffect(() => {
    if (pushBridge() !== null) return;
    let subscribed = true;
    let unlisten: (() => void) | null = null;
    void onOpenReview((question) => { openReviewList(question, "tab"); }).then((stop) => {
      if (subscribed) unlisten = stop;
      else stop();
    });
    return () => {
      subscribed = false;
      unlisten?.();
    };
  }, []);
}
