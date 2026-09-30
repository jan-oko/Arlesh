import { useTranslation } from "react-i18next";
import { useAgentCapacity } from "@/hooks/use-agent-capacity";
import { useDisplayStore } from "@/stores/use-display-store";
import Switch from "@/components/Switch/Switch";
import styles from "./SettingsModal.module.css";
import own from "./McpEndpointSection.module.css";

/**
 * The agent capacity lock and the setting that decides what it does. The lock is shared with every
 * window and with agents over the MCP, which set and clear it too; the setting is this app's own
 * preference, whether Start hides Agentic tasks while the lock is on.
 */
export default function AgentCapacitySection() {
  const { t } = useTranslation("settings");
  const { atCapacity, error, setAtCapacity } = useAgentCapacity();
  const hides = useDisplayStore((s) => s.startHidesAgenticAtCapacity);
  const toggleHides = useDisplayStore((s) => s.toggleStartHidesAgenticAtCapacity);

  return (
    <section className={own.section} aria-label={t("mcp.capacity.heading")}>
      <h3 className={styles.heading}>{t("mcp.capacity.heading")}</h3>
      <p className={styles.note}>{t("mcp.capacity.note")}</p>
      <Switch checked={atCapacity} onChange={(next) => { void setAtCapacity(next); }} label={t("mcp.capacity.lock")} />
      <Switch checked={hides} onChange={toggleHides} label={t("mcp.capacity.hides")} />
      {error !== null && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}
