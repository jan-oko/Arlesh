import StepsZoomSetting from "./StepsZoomSetting";
import styles from "./SettingsModal.module.css";

/** How big a Steps card is drawn. Per tab. */
export default function StepsPage() {
  return (
    <div className={styles.page}>
      <StepsZoomSetting />
    </div>
  );
}
