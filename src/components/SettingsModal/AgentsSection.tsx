import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Account } from "@/api/agents";
import { useAgents } from "@/hooks/use-agents";
import Switch from "@/components/Switch/Switch";
import { useDisplayStore } from "@/stores/use-display-store";
import { useSettingsStore } from "@/stores/use-settings-store";
import { capitalised } from "@/utils/agents";
import { accountRowId, AGENTS_SECTION_ID } from "@/utils/agent-anchors";
import AccountControls from "./AccountControls";
import AgentChildren from "./AgentChildren";
import AgentRow from "./AgentRow";
import HelpTip from "./HelpTip";
import styles from "./SettingsModal.module.css";
import own from "./AgentsSection.module.css";

/** How long a row the status menu pointed at stays marked. */
const HIGHLIGHT_MS = 2500;

/**
 * The agents attached to the board, apart from the Devices list: a PIN to give a new one, each
 * agent with its Claim, standing and hand controls, grouped by account, each account with its lock
 * switch and limits (inline with the title when only one account is in use).
 */
export default function AgentsSection() {
  const { t } = useTranslation("settings");
  const { overview, nodes, isLoading, error, pin, act, lockAccount, requestPin } = useAgents();
  const [copied, setCopied] = useState(false);
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
  const accountLabels = [...new Set(topLevel.map(({ agent }) => agent.account))];
  const accountNamed = (label: string) => overview.accounts.find((account) => account.label === label);
  const lockControls = (account: Account) => (
    <AccountControls account={account} onLock={(locked) => { void lockAccount(account.label, locked); }} />
  );
  const rowsOf = (summaries: typeof topLevel) => summaries.map((summary) => (
    <AgentRow
      key={summary.agent.id}
      summary={summary}
      nodes={nodes}
      onAct={(action) => { void act(summary.agent.id, action); }}
    >
      {childrenOf(summary.agent.id).length > 0 && (
        <AgentChildren parent={summary.agent.name} count={childrenOf(summary.agent.id).length}>
          {childrenOf(summary.agent.id).map((child) => (
            <AgentRow
              key={child.agent.id}
              summary={child}
              nodes={nodes}
              onAct={(action) => { void act(child.agent.id, action); }}
            />
          ))}
        </AgentChildren>
      )}
    </AgentRow>
  ));
  const single = accountLabels.length === 1 ? accountNamed(accountLabels[0] ?? "") : undefined;

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
        {single !== undefined && (
          <span id={accountRowId(single.label)} className={own.groupHeader}>{lockControls(single)}</span>
        )}
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
      {overview.agents.length > 0 && single !== undefined && (
        <ul className={own.list} aria-label={t("mcp.agents.list")}>{rowsOf(topLevel)}</ul>
      )}
      {overview.agents.length > 0 && single === undefined && (
        <div className={own.groups}>
          {accountLabels.map((label) => {
            const account = accountNamed(label);
            return (
              <div
                key={label}
                id={accountRowId(label)}
                className={own.group}
                role="group"
                aria-labelledby={`${accountRowId(label)}-name`}
              >
                <div className={own.groupHeader}>
                  <span id={`${accountRowId(label)}-name`} className={own.groupName}>{capitalised(label)}</span>
                  {account !== undefined && lockControls(account)}
                </div>
                <ul className={own.list} aria-label={t("mcp.agents.list")}>{rowsOf(topLevel.filter(({ agent }) => agent.account === label))}</ul>
              </div>
            );
          })}
        </div>
      )}
      <Switch checked={showStatus} onChange={toggleShowStatus} label={t("mcp.agents.showStatus")} />
    </section>
  );
}
