import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAgentStatus } from "@/hooks/use-agent-status";
import { useDisplayStore } from "@/stores/use-display-store";
import { useStagedSender } from "@/hooks/use-answer-drafts";
import AgentHeadIcon from "./AgentHeadIcon";
import AgentCapacityIcon from "./AgentCapacityIcon";
import AgentQuestionIcon from "./AgentQuestionIcon";
import AgentWaitIcon from "./AgentWaitIcon";
import AgentOnAgentIcon from "./AgentOnAgentIcon";
import AgentStagedIcon from "./AgentStagedIcon";
import styles from "./AgentStatus.module.css";

/**
 * The agents' status in the top bar: a small bot head with a row of icons under it — the agents' capacity
 * padlock, Agentic Tasks waiting on your Review, waits on something else, Agentic Tasks On Agent, in that
 * order, each only while it applies, and no counts. Drawn only while at least one applies, and
 * never while the "Show agent status in the top bar" setting is off. The
 * tooltip spells each out with its count; a click opens a small menu with one line each — Open on
 * the padlock (Settings, on the Agents section), Show on the others.
 *
 * While any answer is **staged** (ADR 0021) it also shows a staged icon, and its menu gains a line that
 * **sends** them all. Like the rest it follows the "Show agent status in the top bar" setting: with it off,
 * the field's Send and the command palette are the ways to send.
 */
export default function AgentStatus() {
  const { t } = useTranslation("common");
  const status = useAgentStatus();
  const shown = useDisplayStore((s) => s.showAgentStatus);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const sender = useStagedSender();
  // Staged answers are one more status here (ADR 0021): the head is drawn for them too, with its icon.
  if (!shown || !(status.isActive || sender.count > 0)) return null;

  const lines: string[] = [
    ...(status.atCapacity ? [t("agentStatus.capacity", { count: status.capacityCount })] : []),
    ...(status.review > 0 ? [t("agentStatus.review", { count: status.review })] : []),
    ...(status.waits > 0 ? [t("agentStatus.waits", { count: status.waits })] : []),
    ...(status.onAgent > 0 ? [t("agentStatus.onAgent", { count: status.onAgent })] : []),
    ...(sender.count > 0 ? [t("agentStatus.staged", { count: sender.count })] : []),
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
          {status.review > 0 && <span className={styles.ask}><AgentQuestionIcon /></span>}
          {status.waits > 0 && <span className={styles.wait}><AgentWaitIcon /></span>}
          {status.onAgent > 0 && <span className={styles.progress}><AgentOnAgentIcon /></span>}
          {sender.count > 0 && <span className={styles.staged}><AgentStagedIcon /></span>}
        </span>
      </button>
      {open && (
        <>
          <div className={styles.backdrop} onClick={() => setOpen(false)} />
          <div className={styles.menu} role="menu" aria-label={t("agentStatus.menu")}>
            {status.atCapacity && (
              <Line text={t("agentStatus.capacity", { count: status.capacityCount })} action={t("agentStatus.open")} onAct={act(status.openCapacity)} />
            )}
            {status.review > 0 && (
              <Line text={t("agentStatus.review", { count: status.review })} action={t("agentStatus.show")} onAct={act(status.showReview)} />
            )}
            {status.waits > 0 && (
              <Line text={t("agentStatus.waits", { count: status.waits })} action={t("agentStatus.show")} onAct={act(status.showWaits)} />
            )}
            {status.onAgent > 0 && (
              <Line text={t("agentStatus.onAgent", { count: status.onAgent })} action={t("agentStatus.show")} onAct={act(status.showOnAgent)} />
            )}
            {sender.count > 0 && (
              <Line text={t("agentStatus.staged", { count: sender.count })} action={t("agentStatus.send")} onAct={act(() => void sender.send())} />
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
