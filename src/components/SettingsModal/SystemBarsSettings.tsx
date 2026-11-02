import { useTranslation } from "react-i18next";
import { useDisplayStore } from "@/stores/use-display-store";
import { usePhoneLayout } from "@/hooks/use-media-query";
import { isAndroid } from "@/utils/platform";
import { SYSTEM_BARS_MODES } from "@/utils/system-bars";
import SegmentedControl from "@/components/SegmentedControl/SegmentedControl";
import HelpTip from "./HelpTip";
import styles from "./SystemBarsSettings.module.css";

/**
 * How the app sits against the Android system bars, separately for normal display and for
 * fullscreen. Offered where it applies, on Android or in the phone layout; the desktop window
 * ignores it.
 */
export default function SystemBarsSettings() {
  const { t } = useTranslation("common");
  const phone = usePhoneLayout();
  const normal = useDisplayStore((s) => s.systemBars);
  const setNormal = useDisplayStore((s) => s.setSystemBars);
  const fullscreen = useDisplayStore((s) => s.systemBarsFullscreen);
  const setFullscreen = useDisplayStore((s) => s.setSystemBarsFullscreen);
  if (!isAndroid() && !phone) return null;

  const options = SYSTEM_BARS_MODES.map((mode) => ({ value: mode, label: t(`systemBarsMode.${mode}`) }));
  return (
    <>
      <div className={styles.field}>
        <div className={styles.label}>
          <span>{t("systemBars")}</span>
          <HelpTip text={t("systemBarsHelp")} label={t("systemBarsHelpLabel")} />
        </div>
        <SegmentedControl value={normal} options={options} onChange={setNormal} ariaLabel={t("systemBars")} />
      </div>
      <div className={styles.field}>
        <div className={styles.label}>
          <span>{t("systemBarsFullscreen")}</span>
          <HelpTip text={t("systemBarsFullscreenHelp")} label={t("systemBarsFullscreenHelpLabel")} />
        </div>
        <SegmentedControl value={fullscreen} options={options} onChange={setFullscreen} ariaLabel={t("systemBarsFullscreen")} />
      </div>
    </>
  );
}
