import { useTranslation } from "react-i18next";
import { useInputCapture } from "@/hooks/use-input-capture";
import styles from "./FirstRunChooser.module.css";

interface Props {
  /** *This device only*: Standalone, as the app already runs. */
  onStandalone: () => void;
  /** *Connect to a server*: opens Settings → Server. */
  onServer: () => void;
}

/**
 * The first-run question: where the board lives. Asked once, on a device with no board yet and no
 * mode chosen; the app runs Standalone meanwhile, which is the first answer.
 */
export default function FirstRunChooser({ onStandalone, onServer }: Props) {
  useInputCapture();
  const { t } = useTranslation("server");
  return (
    <div className={styles.overlay}>
      <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="first-run-title">
        <h2 id="first-run-title" className={styles.heading}>{t("chooser.title")}</h2>
        <button autoFocus type="button" className={styles.choice} onClick={onStandalone}>
          <span className={styles.label}>{t("chooser.standalone")}</span>
          <span className={styles.hint}>{t("chooser.standaloneHint")}</span>
        </button>
        <button type="button" className={styles.choice} onClick={onServer}>
          <span className={styles.label}>{t("chooser.client")}</span>
          <span className={styles.hint}>{t("chooser.clientHint")}</span>
        </button>
        <p className={styles.hint}>{t("chooser.intro")}</p>
      </div>
    </div>
  );
}
