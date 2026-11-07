import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAgents } from "@/hooks/use-agents";
import Switch from "@/components/Switch/Switch";
import AgentRow from "./AgentRow";
import HelpTip from "./HelpTip";
import styles from "./SettingsModal.module.css";
import own from "./AgentsSection.module.css";

/**
 * The agents attached to the board, apart from the Devices list: a PIN to give a new one, each
 * agent with its Claim, standing, account usage and hand controls, and the accounts with their locks.
 */
export default function AgentsSection() {
  const { t } = useTranslation("settings");
  const { overview, nodes, isLoading, error, pin, act, lockAccount, requestPin } = useAgents();
  const [copied, setCopied] = useState(false);

  async function copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className={styles.page} aria-label={t("mcp.agents.heading")}>
      <div className={own.pinRow}>
        <h3 className={styles.heading}>{t("mcp.agents.heading")}</h3>
        <HelpTip text={t("mcp.agents.intro")} label={t("mcp.agents.help")} />
      </div>
      <div className={own.pinRow}>
        <button className={styles.button} type="button" onClick={() => { setCopied(false); void requestPin(); }}>
          {t("mcp.agents.getPin")}
        </button>
        {pin !== null && (
          <>
            <span className={own.pin} aria-label={t("mcp.agents.pinHeading")}>{pin.pin}</span>
            <span className={own.meta}>
              {t("mcp.agents.pinExpires", { time: new Date(pin.expires_at).toLocaleTimeString() })}
            </span>
            <button className={styles.button} type="button" onClick={() => { void copy(pin.pin); }}>
              {copied ? t("mcp.agents.pinCopied") : t("mcp.agents.pinCopy")}
            </button>
          </>
        )}
      </div>
      {pin !== null && <p className={styles.note}>{t("mcp.agents.pinHelp")}</p>}
      {error !== null && <p className={styles.error} role="alert">{error}</p>}
      {isLoading && <p className={styles.note}>{t("mcp.agents.loading")}</p>}
      {!isLoading && error === null && overview.agents.length === 0 && (
        <p className={styles.note}>{t("mcp.agents.none")}</p>
      )}
      {overview.agents.length > 0 && (
        <ul className={own.list} aria-label={t("mcp.agents.list")}>
          {overview.agents.map((summary) => (
            <AgentRow
              key={summary.agent.id}
              summary={summary}
              account={overview.accounts.find((account) => account.label === summary.agent.account)}
              nodes={nodes}
              onAct={(action) => { void act(summary.agent.id, action); }}
            />
          ))}
        </ul>
      )}
      <h3 className={styles.heading}>{t("mcp.agents.accountsHeading")}</h3>
      {overview.accounts.length === 0 && <p className={styles.note}>{t("mcp.agents.accountsNone")}</p>}
      {overview.accounts.map((account) => (
        <div key={account.label} className={own.agent}>
          <Switch
            checked={account.locked}
            onChange={(locked) => { void lockAccount(account.label, locked); }}
            label={t("mcp.agents.accountLock", { label: account.label })}
          />
          {account.windows.length === 0 && <span className={own.meta}>{t("mcp.agents.noUsage")}</span>}
        </div>
      ))}
    </section>
  );
}
