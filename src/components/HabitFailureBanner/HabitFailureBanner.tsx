import { useTranslation } from "react-i18next";
import styles from "./HabitFailureBanner.module.css";

interface FailedFlow {
  id: number;
  title: string;
}

interface Props {
  failedFlows: FailedFlow[];
  /** Commitment habits whose template holds Goal items, so none of their iterations can be drawn. */
  unrenderableCommitmentFlows?: FailedFlow[];
  onDismiss: () => void;
}

/**
 * A persistent notice that the tree under it is showing less than the whole truth on the most
 * recent load: some flows' Habit iterations failed to derive, or a commitment Habit's template
 * holds Goal items a Commitment cannot parent, so none of its iterations could be drawn. Either
 * way missing iterations look identical to a habit that genuinely has none, which is why they are
 * named here rather than left to be noticed.
 *
 * Unlike `AnchoredToast`, this is not anchored on a node the user just acted on: the condition is
 * background and the node may be anywhere, so it gets a full-width strip instead. It lists every
 * affected flow, persists while the condition holds, and is cleared by the caller once a load
 * comes back clean.
 */
export default function HabitFailureBanner({ failedFlows, unrenderableCommitmentFlows = [], onDismiss }: Props) {
  const { t } = useTranslation(["warnings", "common"]);
  if (failedFlows.length === 0 && unrenderableCommitmentFlows.length === 0) return null;
  const section = (heading: string, flows: FailedFlow[]) =>
    flows.length === 0 ? null : (
      <>
        <div className={styles.heading}>{heading}</div>
        <ul className={styles.list}>
          {flows.map((flow) => (
            <li key={flow.id} className={styles.item}>{flow.title}</li>
          ))}
        </ul>
      </>
    );
  return (
    <div className={styles.banner} role="alert">
      <div className={styles.body}>
        {section(t("habitLoadFailedBanner"), failedFlows)}
        {section(t("commitmentHabitHoldsGoalsBanner"), unrenderableCommitmentFlows)}
      </div>
      <button type="button" className={styles.dismissBtn} aria-label={t("common:dismiss")} onClick={onDismiss}>×</button>
    </div>
  );
}
