import { useTranslation } from "react-i18next";
import { useDisplayStore } from "@/stores/use-display-store";
import Switch from "@/components/Switch/Switch";
import styles from "./SettingsModal.module.css";

/** How much a Zen View card says, and whether the grid shows Started tasks. App-wide. */
export default function ZenPage() {
  const { t } = useTranslation("zenView");
  const showBadges = useDisplayStore((s) => s.zenShowBadges);
  const toggleShowBadges = useDisplayStore((s) => s.toggleZenShowBadges);
  const showsStarted = useDisplayStore((s) => s.zenShowsStarted);
  const toggleShowsStarted = useDisplayStore((s) => s.toggleZenShowsStarted);

  return (
    <div className={styles.page}>
      <Switch checked={showBadges} onChange={toggleShowBadges} label={t("showBadges")} />
      <Switch checked={showsStarted} onChange={toggleShowsStarted} label={t("showsStarted")} />
    </div>
  );
}
