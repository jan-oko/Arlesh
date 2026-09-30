import { useTranslation } from "react-i18next";
import { useDisplayStore } from "@/stores/use-display-store";
import Switch from "@/components/Switch/Switch";
import styles from "./SettingsModal.module.css";

/** How much a Zen View card says. App-wide. */
export default function ZenPage() {
  const { t } = useTranslation("zenView");
  const showBadges = useDisplayStore((s) => s.zenShowBadges);
  const toggleShowBadges = useDisplayStore((s) => s.toggleZenShowBadges);
  const showOverdueBorder = useDisplayStore((s) => s.zenShowOverdueBorder);
  const toggleShowOverdueBorder = useDisplayStore((s) => s.toggleZenShowOverdueBorder);

  return (
    <div className={styles.page}>
      <Switch checked={showBadges} onChange={toggleShowBadges} label={t("showBadges")} />
      <Switch checked={showOverdueBorder} onChange={toggleShowOverdueBorder} label={t("showOverdueBorder")} />
    </div>
  );
}
