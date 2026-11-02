import StepsFillScreenSetting from "./StepsFillScreenSetting";
import StepsZoomSetting from "./StepsZoomSetting";
import styles from "./SettingsModal.module.css";

/** How big a Steps card is drawn (per tab), and how the phone lays the cards out (app-wide). */
export default function StepsPage() {
  return (
    <div className={styles.page}>
      <StepsZoomSetting />
      <StepsFillScreenSetting />
    </div>
  );
}
