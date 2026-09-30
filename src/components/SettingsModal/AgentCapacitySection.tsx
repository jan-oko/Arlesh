import { useTranslation } from "react-i18next";
import { useAgentCapacity } from "@/hooks/use-agent-capacity";
import Switch from "@/components/Switch/Switch";
import styles from "./SettingsModal.module.css";
import own from "./McpEndpointSection.module.css";

/**
 * The agent capacity lock's switch. The lock is shared with every window and with agents over the
 * MCP, which set and clear it too; while it is on, every Agentic Task not yet Done is blocked.
 */
export default function AgentCapacitySection() {
  const { t } = useTranslation("settings");
  const { atCapacity, error, setAtCapacity } = useAgentCapacity();

  return (
    <section className={own.section} aria-label={t("mcp.capacity.heading")}>
      <h3 className={styles.heading}>{t("mcp.capacity.heading")}</h3>
      <p className={styles.note}>{t("mcp.capacity.note")}</p>
      <Switch checked={atCapacity} onChange={(next) => { void setAtCapacity(next); }} label={t("mcp.capacity.lock")} />
      {error !== null && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}
