import { useId, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useInputCapture } from "@/hooks/use-input-capture";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import GeneralPage from "./GeneralPage";
import MindmapPage from "./MindmapPage";
import ListPage from "./ListPage";
import StepsPage from "./StepsPage";
import PlanPage from "./PlanPage";
import WindowsPage from "./WindowsPage";
import ExpectationsPage from "./ExpectationsPage";
import McpAccessPage from "./McpAccessPage";
import styles from "./SettingsModal.module.css";

/** The modal's pages, in the order the sidebar lists them. */
export type SettingsPage =
  | "general" | "mindmap" | "list" | "steps" | "plan" | "windows" | "expectations" | "mcp";

const PAGES: readonly SettingsPage[] = [
  "general", "mindmap", "list", "steps", "plan", "windows", "expectations", "mcp",
];

const CLOSE_GLYPH = "×";

interface Props {
  onClose: () => void;
  /** Closes the settings and opens the keyboard cheat-sheet. */
  onOpenHotkeys: () => void;
  /** The page it opens on. General unless a caller knows better. */
  initialPage?: SettingsPage;
}

/**
 * Every setting the app has, in one modal organised into pages — opened from the top bar's gear.
 *
 * It replaced a popover whose view-scoped switches appeared and disappeared with the active view:
 * a setting could only be found from the view it acted on, and the popover had nowhere to put a
 * page like MCP access. Here every page is always reachable, and the settings themselves are the
 * same stores they always were — this is where they are shown, not how they are kept.
 *
 * Keyboard: focus starts on the current page's tab and stays inside the modal; ↑/↓ (and Home/End)
 * move between pages; Escape or the × closes. A nested dialog — the MCP page's node search — takes
 * Escape first, so one press closes one thing.
 */
export default function SettingsModal({ onClose, onOpenHotkeys, initialPage = "general" }: Props) {
  useInputCapture();
  const { t } = useTranslation("settings");
  const [page, setPage] = useState<SettingsPage>(initialPage);
  const trap = useFocusTrap<HTMLDivElement>();
  const titleId = useId();
  const tabId = (candidate: SettingsPage) => `${titleId}-tab-${candidate}`;
  const panelId = `${titleId}-panel`;

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const target = (() => {
      switch (event.key) {
        case "ArrowDown": return PAGES[(index + 1) % PAGES.length];
        case "ArrowUp": return PAGES[(index - 1 + PAGES.length) % PAGES.length];
        case "Home": return PAGES[0];
        case "End": return PAGES[PAGES.length - 1];
        default: return undefined;
      }
    })();
    if (target === undefined) return;
    event.preventDefault();
    setPage(target);
    document.getElementById(tabId(target))?.focus();
  }

  const content: Record<SettingsPage, ReactNode> = {
    general: <GeneralPage onOpenHotkeys={onOpenHotkeys} />,
    mindmap: <MindmapPage />,
    list: <ListPage />,
    steps: <StepsPage />,
    plan: <PlanPage />,
    windows: <WindowsPage />,
    expectations: <ExpectationsPage />,
    mcp: <McpAccessPage />,
  };

  return (
    <div className={styles.overlay} onMouseDown={onClose}>
      <div
        ref={trap}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <header className={styles.header}>
          <h2 id={titleId} className={styles.title}>{t("title")}</h2>
          <button className={styles.close} type="button" aria-label={t("close")} title={t("close")} onClick={onClose}>
            {CLOSE_GLYPH}
          </button>
        </header>
        <div className={styles.body}>
          <div className={styles.tabs} role="tablist" aria-orientation="vertical" aria-label={t("pages")}>
            {PAGES.map((candidate, index) => (
              <button
                key={candidate}
                id={tabId(candidate)}
                className={styles.tab}
                type="button"
                role="tab"
                aria-selected={candidate === page}
                aria-controls={panelId}
                tabIndex={candidate === page ? 0 : -1}
                autoFocus={candidate === initialPage}
                onClick={() => setPage(candidate)}
                onKeyDown={(event) => moveTab(event, index)}
              >
                {t(`page.${candidate}`)}
              </button>
            ))}
          </div>
          <section id={panelId} className={styles.panel} role="tabpanel" aria-labelledby={tabId(page)}>
            <h3 className={styles.pageTitle}>{t(`page.${page}`)}</h3>
            {content[page]}
          </section>
        </div>
      </div>
    </div>
  );
}
