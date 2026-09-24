import CheckTaskPrefixSetting from "./CheckTaskPrefixSetting";
import styles from "./SettingsModal.module.css";

/** How a wait's check task is titled. App-wide, the same in every view. */
export default function ExpectationsPage() {
  return (
    <div className={styles.page}>
      <CheckTaskPrefixSetting />
    </div>
  );
}
