import { useTranslation } from "react-i18next";
import "@/styles/tokens.css";
import TopBar from "@/components/TopBar/TopBar";
import MindmapView from "@/components/MindmapView/MindmapView";
import styles from "./App.module.css";

export default function App() {
  const { i18n } = useTranslation();
  return (
    <div className={styles.shell} dir={i18n.dir()}>
      <TopBar />
      <MindmapView />
    </div>
  );
}
