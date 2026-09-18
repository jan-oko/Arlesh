import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useTabsStore } from "@/stores/use-tabs-store";
import { useTabCommands } from "@/hooks/use-tab-commands";
import styles from "./TabStrip.module.css";

const ADD_ICON = "+";
const CLOSE_ICON = "×";
/** The mouse button that closes a tab, per the browser convention. */
const MIDDLE_BUTTON = 1;

/**
 * The open tabs, above the top bar.
 *
 * A tab is labelled by the subtree it is rooted at; one showing the whole tree is labelled for
 * that rather than left nameless. Closing is offered twice — an × and a middle-click — because
 * both are the gesture somebody already has.
 */
export default function TabStrip() {
  const { t } = useTranslation(["common"]);
  const tabs = useTabsStore((s) => s.tabs);
  const activeTabId = useTabsStore((s) => s.activeTabId);
  const activateTab = useTabsStore((s) => s.activateTab);
  const moveTab = useTabsStore((s) => s.moveTab);
  const { openTab, closeTab } = useTabCommands();
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  function drop(toIndex: number) {
    if (draggingIndex !== null) moveTab(draggingIndex, toIndex);
    setDraggingIndex(null);
  }

  return (
    <div className={styles.strip} role="tablist" aria-label={t("common:tabs")}>
      {tabs.map((tab, index) => (
        <div
          key={tab.id}
          className={`${styles.tab}${tab.id === activeTabId ? ` ${styles.tabActive}` : ""}${draggingIndex === index ? ` ${styles.tabDragging}` : ""}`}
          draggable
          onDragStart={() => setDraggingIndex(index)}
          onDragEnd={() => setDraggingIndex(null)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); drop(index); }}
          onAuxClick={(e) => { if (e.button === MIDDLE_BUTTON) { e.preventDefault(); closeTab(tab.id); } }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab.id === activeTabId}
            className={styles.label}
            onClick={() => activateTab(tab.id)}
          >
            {tab.title ?? t("common:tabWholeTree")}
          </button>
          <button
            type="button"
            className={styles.close}
            aria-label={t("common:closeTab")}
            onClick={() => closeTab(tab.id)}
          >
            <span aria-hidden="true">{CLOSE_ICON}</span>
          </button>
        </div>
      ))}
      <button type="button" className={styles.add} aria-label={t("common:newTab")} onClick={openTab}>
        <span aria-hidden="true">{ADD_ICON}</span>
      </button>
    </div>
  );
}
