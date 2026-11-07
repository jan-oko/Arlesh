import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Account, AgentSummary, CapacityCause } from "@/api/agents";
import type { AgentAction } from "@/api/agents";
import type { McpCatalogueNode } from "@/api/mcp-access";
import { controlsFor, relativeTime } from "@/utils/agents";
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
  const named = (key: string) => t(`settings:mcp.agents.${key}`);
  const labelled = (key: string) =>
    t("settings:mcp.agents.forAgent", { action: named(key), name: agent.name });

  return (
    <li className={own.agent}>
      <div className={own.head}>
        <span className={own.name}>{agent.name}</span>
        <span className={own.badge} title={t(`settings:mcp.agents.standingNote.${standing}`)}>
          {t(`settings:mcp.agents.standing.${standing}`)}
        </span>
        <span className={own.meta}>{t("settings:mcp.agents.account", { account: agent.account })}</span>
        <span className={own.meta}>
          {agent.last_seen_at === null
            ? t("settings:mcp.agents.neverSeen")
            : t("settings:mcp.agents.lastSeen", { time: relativeTime(agent.last_seen_at, now) })}
        </span>
      </div>
      <div className={own.meta}>
        {claimRow === null || claimRow === undefined
          ? t("settings:mcp.agents.noClaim")
          : [
            claimRow.title ?? t("settings:mcp.missing"),
            claimRow.kind === null ? null : t(`nodeKinds:${claimRow.kind}`),
            claimRow.path.length > 0 ? claimRow.path.join(" › ") : null,
          ].filter((part) => part !== null).join(" · ")}
      </div>
      {standing !== "active" && standing !== "paused" && standing !== "unclaimed" && (
        <div className={own.meta}>{t(`settings:mcp.agents.standingNote.${standing}`)}</div>
      )}
      {summary.at_capacity !== null && (
        <div className={own.capacity}>{capacityText(summary.at_capacity, now, t)}</div>
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

function capacityText(
  cause: CapacityCause,
  now: Date,
  t: (key: string, options?: Record<string, string>) => string,
): string {
  if (cause.kind === "usage_limit") {
    return t("settings:mcp.agents.capacity.usage_limit", {
      window: cause.window,
      time: relativeTime(cause.resets_at, now),
    });
  }
  return t(`settings:mcp.agents.capacity.${cause.kind}`);
}
