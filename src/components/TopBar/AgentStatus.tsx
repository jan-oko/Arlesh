import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAgentStatus } from "@/hooks/use-agent-status";
import AgentHeadIcon from "./AgentHeadIcon";
import AgentCapacityIcon from "./AgentCapacityIcon";
import AgentQuestionIcon from "./AgentQuestionIcon";
import AgentWaitIcon from "./AgentWaitIcon";
import AgentInProgressIcon from "./AgentInProgressIcon";
import styles from "./AgentStatus.module.css";

/**
 * The agents' status in the top bar: a small bot head with a row of icons under it — the capacity
 * lock, questions waiting for you, waits on something else, Agentic Tasks In Progress, in that
 * order, each only while it applies, and no counts. Drawn only while at least one applies. The
 * tooltip spells each out with its count; a click opens a small menu with one line each — Clear on
 * the lock, Show on the others.
 */
export default function AgentStatus() {
  const { t } = useTranslation("common");
  const status = useAgentStatus();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!status.isActive) return null;

  const lines: string[] = [
    ...(status.atCapacity ? [t("agentStatus.capacity")] : []),
    ...(status.questions > 0 ? [t("agentStatus.questions", { count: status.questions })] : []),
    ...(status.waits > 0 ? [t("agentStatus.waits", { count: status.waits })] : []),
    ...(status.inProgress > 0 ? [t("agentStatus.inProgress", { count: status.inProgress })] : []),
  ];
  const label = [...lines, t("agentStatus.details")].join(" ");
  const act = (action: () => void) => () => { setOpen(false); action(); };

  return (
    <div className={styles.anchor}>
      <button
        className={styles.agent}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <span className={styles.head}><AgentHeadIcon /></span>
        <span className={styles.row}>
          {status.atCapacity && <span className={styles.capacity}><AgentCapacityIcon /></span>}
          {status.questions > 0 && <span className={styles.ask}><AgentQuestionIcon /></span>}
          {status.waits > 0 && <span className={styles.wait}><AgentWaitIcon /></span>}
          {status.inProgress > 0 && <span className={styles.progress}><AgentInProgressIcon /></span>}
        </span>
      </button>
      {open && (
        <>
          <div className={styles.backdrop} onClick={() => setOpen(false)} />
          <div className={styles.menu} role="menu" aria-label={t("agentStatus.menu")}>
            {status.atCapacity && (
              <Line text={t("agentStatus.capacity")} action={t("agentStatus.clear")} onAct={act(status.clearCapacity)} />
            )}
            {status.questions > 0 && (
              <Line text={t("agentStatus.questions", { count: status.questions })} action={t("agentStatus.show")} onAct={act(status.showWaits)} />
            )}
            {status.waits > 0 && (
              <Line text={t("agentStatus.waits", { count: status.waits })} action={t("agentStatus.show")} onAct={act(status.showWaits)} />
            )}
            {status.inProgress > 0 && (
              <Line text={t("agentStatus.inProgress", { count: status.inProgress })} action={t("agentStatus.show")} onAct={act(status.showInProgress)} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

interface LineProps {
  text: string;
  action: string;
  onAct: () => void;
}

/** One line of the menu: what applies, and the one thing to do about it. */
function Line({ text, action, onAct }: LineProps) {
  return (
    <div className={styles.line}>
      <span className={styles.lineText}>{text}</span>
      <button className={styles.lineAction} type="button" role="menuitem" aria-label={`${action}: ${text}`} onClick={onAct}>
        {action}
      </button>
    </div>
  );
}
