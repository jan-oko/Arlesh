import { useTranslation } from "react-i18next";
import styles from "./HabitFailureBanner.module.css";

interface FailedFlow {
  id: number;
  title: string;
}

interface Props {
  failedFlows: FailedFlow[];
  onDismiss: () => void;
}

/**
 * A persistent notice that some flows' Habit iterations failed to derive on the most recent
 * load — meaning the tree currently under it is showing wrong data (missing iterations look
 * identical to a habit that genuinely has none). Unlike `AnchoredToast`, this is not anchored on
 * a node the user just acted on: the failure is background and the node may be anywhere, so it
 * gets a full-width strip instead. It lists every failed flow, persists while the condition
 * holds, and is cleared by the caller once a load comes back with none.
 */
export default function HabitFailureBanner({ failedFlows, onDismiss }: Props) {
  const { t } = useTranslation(["warnings", "common"]);
  if (failedFlows.length === 0) return null;
  return (
    <div className={styles.banner} role="alert">
      <div className={styles.body}>
        <div className={styles.heading}>{t("habitLoadFailedBanner")}</div>
        <ul className={styles.list}>
          {failedFlows.map((flow) => (
            <li key={flow.id} className={styles.item}>{flow.title}</li>
          ))}
        </ul>
      </div>
      <button type="button" className={styles.dismissBtn} aria-label={t("common:dismiss")} onClick={onDismiss}>×</button>
    </div>
  );
}
