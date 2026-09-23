import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { setWindowTitle } from "@/api/window";
import { useTabsStore } from "@/stores/use-tabs-store";
import { tabLabel } from "@/utils/tab-label";

/**
 * Keeps the window's title showing its active tab.
 *
 * The title is what the tray menu lists a window by, and with several windows open it is the only
 * thing that tells them apart at a glance — a window's label is a UUID and its number alone says
 * nothing about what is in it. So the title carries both: the number, which the backend fixes for
 * the window's life, and the tab, which changes as the window is used.
 *
 * Only the tab name is sent. Composing the two is the backend's, because the number is.
 */
export function useWindowTitle(): void {
  const { t } = useTranslation(["common"]);
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);

  const active = tabs.find((tab) => tab.id === activeTabId);
  const label = active === undefined ? "" : tabLabel(active, t("common:tabWholeTree"));

  useEffect(() => {
    // A window with no title is a cosmetic failure, never a reason to interrupt anything.
    void setWindowTitle(label).catch(() => {});
  }, [label]);
}
