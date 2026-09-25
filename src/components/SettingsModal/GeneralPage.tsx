import { useTranslation } from "react-i18next";
import { useThemeStore } from "@/stores/use-theme-store";
import Switch from "@/components/Switch/Switch";
import styles from "./SettingsModal.module.css";

interface Props {
  /** Closes the settings and opens the keyboard cheat-sheet in their place. */
  onOpenHotkeys: () => void;
}

/** Appearance, and the way to the keyboard cheat-sheet. App-wide. */
export default function GeneralPage({ onOpenHotkeys }: Props) {
  const { t } = useTranslation("common");
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);

  return (
    <div className={styles.page}>
      <Switch checked={theme === "light"} onChange={toggleTheme} label={t("lightMode")} />
      <div>
        <button className={styles.button} type="button" onClick={onOpenHotkeys}>
          {t("keyboardShortcuts")}
        </button>
      </div>
    </div>
  );
}
