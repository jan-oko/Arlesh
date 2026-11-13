import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Account, AgentStanding, AgentSummary, CapacityCause } from "@/api/agents";
import type { AgentAction } from "@/api/agents";
import type { McpCatalogueNode } from "@/api/mcp-access";
import { agentRowId } from "@/utils/agent-anchors";
import { capitalised, controlsFor, relativeTime, shortAge } from "@/utils/agents";
import { describeRoots } from "@/utils/mcp-roots";
import styles from "./SettingsModal.module.css";
import own from "./AgentsSection.module.css";

interface Props {
  summary: AgentSummary;
  account: Account | undefined;
  nodes: readonly McpCatalogueNode[];
  onAct: (action: AgentAction) => void;
}

/** One agent: who it is, what it holds, how it stands, and the hand controls its standing allows. */
export default function AgentRow({ summary, account, nodes, onAct }: Props) {
  const { t } = useTranslation(["settings", "nodeKinds"]);
  const [removing, setRemoving] = useState(false);
  const { agent, standing } = summary;
  const controls = controlsFor(summary);
  const now = new Date();
  const claimRow = agent.claim === null ? null : describeRoots([agent.claim.root], nodes, [])[0];
  const names = {
    pause: t("settings:mcp.agents.pause"),
    resume: t("settings:mcp.agents.resume"),
    release: t("settings:mcp.agents.release"),
    lock: t("settings:mcp.agents.lock"),
    unlock: t("settings:mcp.agents.unlock"),
    remove: t("settings:mcp.agents.remove"),
    removeConfirm: t("settings:mcp.agents.removeConfirm"),
    removeCancel: t("settings:mcp.agents.removeCancel"),
  };
  const named = (key: keyof typeof names): string => names[key];
  const labelled = (key: keyof typeof names) =>
    t("settings:mcp.agents.forAgent", { action: names[key], name: agent.name });
  const standingNames: Record<AgentStanding, string> = {
    unclaimed: t("settings:mcp.agents.standing.unclaimed"),
    active: t("settings:mcp.agents.standing.active"),
    paused: t("settings:mcp.agents.standing.paused"),
    shadowed: t("settings:mcp.agents.standing.shadowed"),
    unreachable: t("settings:mcp.agents.standing.unreachable"),
  };
  const standingNotes: Record<AgentStanding, string> = {
    unclaimed: t("settings:mcp.agents.standingNote.unclaimed"),
    active: t("settings:mcp.agents.standingNote.active"),
    paused: t("settings:mcp.agents.standingNote.paused"),
    shadowed: t("settings:mcp.agents.standingNote.shadowed"),
    unreachable: t("settings:mcp.agents.standingNote.unreachable"),
  };

  return (
    <li id={agentRowId(agent.id)} className={own.agent}>
      <div className={own.head}>
        {[
          <span key="name" className={own.name}>{agent.name}</span>,
          <span key="standing" className={own.badge} title={standingNotes[standing]}>
            {standingNames[standing]}
          </span>,
          <span key="account" className={own.meta}>{capitalised(agent.account)}</span>,
          <span key="seen" className={own.meta}>
            {agent.last_seen_at === null
              ? t("settings:mcp.agents.neverSeen")
              : t("settings:mcp.agents.lastSeen", { time: shortAge(agent.last_seen_at, now) })}
          </span>,
        ].flatMap((segment, index) => index === 0
          ? [segment]
          : [<span key={`dot-${segment.key ?? index}`} className={own.meta} aria-hidden="true">{t("settings:mcp.agents.separator")}</span>, segment])}
      </div>
      <div className={own.meta}>
        {claimRow === null || claimRow === undefined
          ? t("settings:mcp.agents.noClaim")
          : [...claimRow.path, claimRow.title ?? t("settings:mcp.missing")].join(t("settings:mcp.agents.pathSeparator"))}
      </div>
      {standing !== "active" && standing !== "paused" && standing !== "unclaimed" && (
        <div className={own.meta}>{standingNotes[standing]}</div>
      )}
      {summary.at_capacity !== null && (
        <div className={own.capacity}>{capacityText(summary.at_capacity, now, {
          agentLocked: t("settings:mcp.agents.capacity.agent_locked"),
          accountLocked: t("settings:mcp.agents.capacity.account_locked"),
          usage: (window, time) => t("settings:mcp.agents.capacity.usage_limit", { window, time }),
        })}</div>
      )}
      {account !== undefined && account.windows.map((window) => (
        <div key={window.kind} className={own.meta}>
          {t("settings:mcp.agents.window", {
            window: window.kind,
            percent: Math.round(window.percent_used),
            time: relativeTime(window.resets_at, now),
          })}
        </div>
      ))}
      <div className={own.actions}>
        {controls.canPause && (
          <button className={styles.button} type="button" aria-label={labelled("pause")} onClick={() => onAct({ action: "pause" })}>
            {named("pause")}
          </button>
        )}
        {controls.canResume && (
          <button className={styles.button} type="button" aria-label={labelled("resume")} onClick={() => onAct({ action: "resume" })}>
            {named("resume")}
          </button>
        )}
        {controls.canRelease && (
          <button className={styles.button} type="button" aria-label={labelled("release")} onClick={() => onAct({ action: "release" })}>
            {named("release")}
          </button>
        )}
        <button
          className={styles.button}
          type="button"
          aria-label={labelled(agent.locked ? "unlock" : "lock")}
          onClick={() => onAct({ action: "lock", locked: !agent.locked })}
        >
          {named(agent.locked ? "unlock" : "lock")}
        </button>
        {!removing && (
          <button className={styles.button} type="button" aria-label={labelled("remove")} onClick={() => setRemoving(true)}>
            {named("remove")}
          </button>
        )}
      </div>
      {removing && (
        <div className={own.actions} role="group" aria-label={t("settings:mcp.agents.removeAsk", { name: agent.name })}>
          <span>{t("settings:mcp.agents.removeAsk", { name: agent.name })}</span>
          <button className={styles.button} type="button" onClick={() => { setRemoving(false); onAct({ action: "remove" }); }}>
            {named("removeConfirm")}
          </button>
          <button className={styles.button} type="button" onClick={() => setRemoving(false)}>
            {named("removeCancel")}
          </button>
        </div>
      )}
    </li>
  );
}

interface CapacityWords {
  agentLocked: string;
  accountLocked: string;
  usage: (window: string, time: string) => string;
}

function capacityText(cause: CapacityCause, now: Date, words: CapacityWords): string {
  switch (cause.kind) {
    case "usage_limit":
      return words.usage(cause.window, relativeTime(cause.resets_at, now));
    case "agent_locked":
      return words.agentLocked;
    case "account_locked":
      return words.accountLocked;
  }
}
