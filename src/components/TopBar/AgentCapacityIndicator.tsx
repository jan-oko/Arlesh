import { useTranslation } from "react-i18next";
import { useAgentCapacity } from "@/hooks/use-agent-capacity";
import AgentCapacityIcon from "./AgentCapacityIcon";
import styles from "./AgentCapacityIndicator.module.css";

/**
 * The top bar's sign that agents are at capacity: an icon (`AgentCapacityIcon`), drawn only while
 * the lock is on — while every Agentic Task not yet Done is blocked by it — and a click clears it.
 * Its words are its tooltip and its accessible name.
 */
export default function AgentCapacityIndicator() {
  const { t } = useTranslation("common");
  const { atCapacity, setAtCapacity } = useAgentCapacity();
  if (!atCapacity) return null;

  return (
    <button
      className={styles.indicator}
      type="button"
      aria-label={t("agentCapacity.title")}
      title={t("agentCapacity.title")}
      onClick={() => { void setAtCapacity(false); }}
    >
      <AgentCapacityIcon />
    </button>
  );
}
