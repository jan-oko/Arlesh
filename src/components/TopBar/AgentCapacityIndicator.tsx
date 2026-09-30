import { useTranslation } from "react-i18next";
import { useAgentCapacity } from "@/hooks/use-agent-capacity";
import styles from "./AgentCapacityIndicator.module.css";

/** A small gauge glyph, needle at the top of its range. */
function GaugeIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 17a9 9 0 1 1 17 0" />
      <path d="M12 14l5-5" />
    </svg>
  );
}

/**
 * The top bar's word that agents are at capacity: drawn only while the lock is on — while every
 * Agentic Task not yet Done is blocked by it — and a click clears it.
 */
export default function AgentCapacityIndicator() {
  const { t } = useTranslation("common");
  const { atCapacity, setAtCapacity } = useAgentCapacity();
  if (!atCapacity) return null;

  return (
    <button
      className={styles.indicator}
      type="button"
      aria-label={t("agentCapacity.clear")}
      title={t("agentCapacity.title")}
      onClick={() => { void setAtCapacity(false); }}
    >
      <GaugeIcon />
      {t("agentCapacity.indicator")}
    </button>
  );
}
