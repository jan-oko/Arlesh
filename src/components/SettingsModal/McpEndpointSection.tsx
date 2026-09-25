import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMcpEndpoint } from "@/hooks/use-mcp-endpoint";
import styles from "./SettingsModal.module.css";
import own from "./McpEndpointSection.module.css";
import McpListenerLine from "./McpListenerLine";

const MIN_PORT = 1;
const MAX_PORT = 65535;

/** The port `text` names, or `null` when it is not a whole number from 1 to 65535. */
function parsePort(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const port = Number(text.trim());
  return port >= MIN_PORT && port <= MAX_PORT ? port : null;
}

/**
 * The MCP endpoint's port and listener: what it is listening on, or why it is not, with a restart
 * and a port change that both take effect at once. `ARLESH_MCP_PORT`, when set, wins over the
 * field, and the page says so.
 */
export default function McpEndpointSection() {
  const { t } = useTranslation("settings");
  const { status, isBusy, error, restart, setPort } = useMcpEndpoint();
  const [draft, setDraft] = useState<string | null>(null);
  const inputId = useId();

  const text = draft ?? (status === null ? "" : String(status.configured_port));
  const parsed = parsePort(text);
  const changed = parsed !== null && status !== null && parsed !== status.configured_port;

  function apply(): void {
    if (parsed === null || !changed) return;
    setDraft(null);
    void setPort(parsed);
  }

  return (
    <section className={own.section} aria-label={t("mcp.endpoint.heading")}>
      <h3 className={styles.heading}>{t("mcp.endpoint.heading")}</h3>
      <div className={own.row}>
        <label htmlFor={inputId}>{t("mcp.endpoint.port")}</label>
        <input
          id={inputId}
          className={own.input}
          type="text"
          inputMode="numeric"
          value={text}
          disabled={status === null}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") apply(); }}
        />
        <button className={styles.button} type="button" onClick={apply} disabled={!changed || isBusy}>
          {t("mcp.endpoint.apply")}
        </button>
      </div>
      {draft !== null && parsed === null && <p className={styles.error}>{t("mcp.endpoint.invalidPort")}</p>}
      {status !== null && status.env_override !== null && (
        <p className={styles.note}>{t("mcp.endpoint.envOverride", { port: status.env_override })}</p>
      )}
      <div className={own.row}>
        {status !== null && <McpListenerLine status={status} />}
        <button className={styles.button} type="button" onClick={() => { void restart(); }} disabled={isBusy || status === null}>
          {t("mcp.endpoint.restart")}
        </button>
      </div>
      {error !== null && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}
