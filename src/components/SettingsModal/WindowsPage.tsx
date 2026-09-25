import { useTranslation } from "react-i18next";
import { useCloseToTrayStore } from "@/stores/use-close-to-tray-store";
import Switch from "@/components/Switch/Switch";
import styles from "./SettingsModal.module.css";

/** What the window's close button does. App-wide. */
export default function WindowsPage() {
  const { t } = useTranslation("common");
  const closeToTray = useCloseToTrayStore((s) => s.closeToTray);
  const toggleCloseToTray = useCloseToTrayStore((s) => s.toggleCloseToTray);

  return (
    <div className={styles.page}>
      <Switch checked={closeToTray} onChange={toggleCloseToTray} label={t("closeToTray")} />
    </div>
  );
}
