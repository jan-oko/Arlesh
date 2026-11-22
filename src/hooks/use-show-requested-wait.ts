import { useEffect } from "react";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { useTabStores } from "@/stores/tab-stores-context";
import { answerFieldOfWait } from "@/utils/answer-focus";

/** How long a requested wait is waited for: the board may still be loading when a notification opens. */
export const REQUESTED_WAIT_PATIENCE_MS = 5000;

/**
 * Shows the open wait a notification is about: scrolls its answer box into view and, when the
 * request says so, focuses it as `Q` does (the focused box carries the selection border). The box
 * may not be drawn yet, so the view passes something that changes as its rows do (`drawn`) and the
 * request is tried again on each change, for {@link REQUESTED_WAIT_PATIENCE_MS}. A wait that is gone
 * never comes: the request lapses, and nothing is focused.
 */
export function useShowRequestedWait(drawn: unknown): void {
  const { mindmap } = useTabStores();
  const requested = useMindmapStore((s) => s.requestedWait);
  useEffect(() => {
    if (requested === null) return;
    const field = answerFieldOfWait(requested.id);
    if (field !== null) {
      if (requested.focus) field.focus();
      if (typeof field.scrollIntoView === "function") field.scrollIntoView({ block: "nearest" });
      mindmap.getState().clearRequestedWait();
      return;
    }
    const timer = window.setTimeout(() => { mindmap.getState().clearRequestedWait(); }, REQUESTED_WAIT_PATIENCE_MS);
    return () => { window.clearTimeout(timer); };
  }, [requested, drawn, mindmap]);
}
