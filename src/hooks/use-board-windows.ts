import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { boardWindowLabels, currentWindowLabel } from "@/api/window";
import { readPersistedTabs } from "@/stores/tab-persistence";
import { tabLabel } from "@/utils/tab-label";

/** Another open window, and something to call it. */
export interface BoardWindow {
  label: string;
  /** What the strip shows for that window's active tab — the one thing about it a user would know. */
  name: string;
}

/** Every open window but this one, and a way to ask again. */
export interface BoardWindows {
  windows: BoardWindow[];
  /** Re-reads the list. Called when the menu that offers them opens, because windows come and go. */
  refresh: () => void;
}

/**
 * The other windows a tab could be moved into.
 *
 * Named by their active tab, because that is the one thing about another window the user can see
 * from here — a window's label is a UUID and a window has no title of its own. The name is read
 * out of that window's stored strip rather than asked of the window itself: every window writes its
 * strip to the shared store on every change, so the value is already local and no round trip can
 * return a stale one that a slower round trip would have corrected.
 */
export function useBoardWindows(): BoardWindows {
  const { t } = useTranslation(["common"]);
  const [windows, setWindows] = useState<BoardWindow[]>([]);

  const refresh = useCallback(() => {
    const mine = currentWindowLabel();
    const wholeTree = t("common:tabWholeTree");
    void boardWindowLabels()
      .then((labels) => {
        setWindows(
          labels
            .filter((label) => label !== mine)
            .map((label) => {
              const strip = readPersistedTabs(label);
              const active = strip?.tabs.find((tab) => tab.id === strip.activeTabId) ?? strip?.tabs[0];
              return {
                label,
                name: active === undefined ? t("common:windowUnnamed") : tabLabel(active, wholeTree),
              };
            }),
        );
      })
      // No answer means no other windows to offer, which is also what a single-window app looks
      // like. Offering a window that might not be there is the worse failure.
      .catch(() => setWindows([]));
  }, [t]);

  return { windows, refresh };
}
