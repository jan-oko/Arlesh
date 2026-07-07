import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import "@/styles/tokens.css";
import TopBar from "@/components/TopBar/TopBar";
import MindmapView from "@/components/MindmapView/MindmapView";
import ListView from "@/components/ListView/ListView";
import { useViewStore } from "@/stores/use-view-store";
import { useThemeStore } from "@/stores/use-theme-store";
import styles from "./App.module.css";

/** Whether a shortcut should be suppressed because the user is typing. */
function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
}

export default function App() {
  const { i18n } = useTranslation();
  const view = useViewStore((s) => s.view);
  const toggleView = useViewStore((s) => s.toggleView);
  const theme = useThemeStore((s) => s.theme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;
      // Matched on the physical key (Alt+L) so it works under any keyboard layout.
      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.code === "KeyL") {
        event.preventDefault();
        toggleView();
      }
    }
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [toggleView]);

  return (
    <div className={styles.shell} dir={i18n.dir()}>
      <TopBar />
      {view === "mindmap" ? <MindmapView /> : <ListView />}
    </div>
  );
}
