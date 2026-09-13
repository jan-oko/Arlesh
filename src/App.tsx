import { useEffect } from "react";
import "@/styles/tokens.css";
import TopBar from "@/components/TopBar/TopBar";
import MindmapView from "@/components/MindmapView/MindmapView";
import ListView from "@/components/ListView/ListView";
import HotkeysModal from "@/components/HotkeysModal/HotkeysModal";
import { useViewStore } from "@/stores/use-view-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useHotkeysStore } from "@/stores/use-hotkeys-store";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { GLOBAL_BINDINGS } from "@/utils/hotkeys/global-bindings";
import styles from "./App.module.css";

export default function App() {
  const view = useViewStore((s) => s.view);
  const toggleView = useViewStore((s) => s.toggleView);
  const theme = useThemeStore((s) => s.theme);
  const hotkeysOpen = useHotkeysStore((s) => s.isOpen);
  const toggleHotkeys = useHotkeysStore((s) => s.toggle);
  const closeHotkeys = useHotkeysStore((s) => s.close);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useHotkeys(GLOBAL_BINDINGS, { onToggleView: toggleView, onToggleHotkeys: toggleHotkeys }, true);

  return (
    <div className={styles.shell}>
      <TopBar />
      {view === "mindmap" ? <MindmapView /> : <ListView />}
      {hotkeysOpen && <HotkeysModal onClose={closeHotkeys} />}
    </div>
  );
}
