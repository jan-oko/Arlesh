import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { AgentSummary } from "@/api/agents";
import { useAgents } from "@/hooks/use-agents";
import { useAgentAccountsStore } from "@/stores/use-agent-accounts-store";
import Switch from "@/components/Switch/Switch";
import { useDisplayStore } from "@/stores/use-display-store";
import { useSettingsStore } from "@/stores/use-settings-store";
import { accountRowId, AGENTS_SECTION_ID } from "@/utils/agent-anchors";
import AgentRow from "./AgentRow";
import HelpTip from "./HelpTip";
import styles from "./SettingsModal.module.css";
import own from "./AgentsSection.module.css";

/** How long a row the status menu pointed at stays marked. */
const HIGHLIGHT_MS = 2500;
const ACCOUNTS_ID = "settings-agent-accounts";
const OPEN_GLYPH = "▾";
const CLOSED_GLYPH = "▸";

/**
 * The agents attached to the board, apart from the Devices list: a PIN to give a new one, each
 * agent with its Claim, standing, account usage and hand controls, and the accounts with their locks.
 */
export default function AgentsSection() {
  const { t } = useTranslation("settings");
  const { overview, nodes, isLoading, error, pin, act, lockAccount, requestPin } = useAgents();
  const [copied, setCopied] = useState(false);
  const accountsOpen = useAgentAccountsStore((state) => state.open);
  const toggleAccounts = useAgentAccountsStore((state) => state.toggle);
  const showStatus = useDisplayStore((s) => s.showAgentStatus);
  const toggleShowStatus = useDisplayStore((s) => s.toggleShowAgentStatus);
  const anchor = useSettingsStore((s) => s.anchor);

  // The status menu opens Settings at a row: scroll to it once the list has drawn, and mark it.
  useEffect(() => {
    if (anchor === null || isLoading) return undefined;
    const target = document.getElementById(anchor);
    if (target === null) return undefined;
    target.scrollIntoView?.({ block: "center" });
    target.setAttribute("data-highlight", "true");
    const timer = window.setTimeout(() => target.removeAttribute("data-highlight"), HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [anchor, isLoading]);

  // A child is nested under its parent; one whose parent is missing (a race) is listed at top level.
  const listed = new Set(overview.agents.map((summary) => summary.agent.id));
  const topLevel = overview.agents.filter(
    ({ agent }) => agent.parent_id === null || !listed.has(agent.parent_id),
  );
  const childrenOf = (id: number) => overview.agents.filter(({ agent }) => agent.parent_id === id);
  const accountOf = (summary: AgentSummary) =>
    overview.accounts.find((account) => account.label === summary.agent.account);

  async function copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section id={AGENTS_SECTION_ID} className={styles.page} aria-label={t("mcp.agents.heading")}>
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
          {topLevel.map((summary) => (
            <AgentRow
              key={summary.agent.id}
              summary={summary}
              account={accountOf(summary)}
              nodes={nodes}
              onAct={(action) => { void act(summary.agent.id, action); }}
            >
              {childrenOf(summary.agent.id).length > 0 && (
                <ul className={own.children} aria-label={t("mcp.agents.subagents", { name: summary.agent.name })}>
                  {childrenOf(summary.agent.id).map((child) => (
                    <AgentRow
                      key={child.agent.id}
                      summary={child}
                      account={undefined}
                      nodes={nodes}
                      onAct={(action) => { void act(child.agent.id, action); }}
                    />
                  ))}
                </ul>
              )}
            </AgentRow>
          ))}
        </ul>
      )}
      <Switch checked={showStatus} onChange={toggleShowStatus} label={t("mcp.agents.showStatus")} />
      <button
        className={own.disclosure}
        type="button"
        aria-expanded={accountsOpen}
        aria-controls={ACCOUNTS_ID}
        onClick={toggleAccounts}
      >
        <span aria-hidden="true">{accountsOpen ? OPEN_GLYPH : CLOSED_GLYPH}</span>
        <span className={styles.heading}>{t("mcp.agents.accountsHeading")}</span>
      </button>
      {accountsOpen && (
        <div id={ACCOUNTS_ID} className={own.accounts}>
          {overview.accounts.length === 0 && <p className={styles.note}>{t("mcp.agents.accountsNone")}</p>}
          {overview.accounts.map((account) => (
            <div key={account.label} id={accountRowId(account.label)} className={own.agent}>
              <Switch
                checked={account.locked}
                onChange={(locked) => { void lockAccount(account.label, locked); }}
                label={t("mcp.agents.accountLock", { label: account.label })}
              />
              {account.windows.length === 0 && <span className={own.meta}>{t("mcp.agents.noUsage")}</span>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
