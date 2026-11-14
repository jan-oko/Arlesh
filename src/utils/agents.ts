import type { AgentSummary } from "@/api/agents";

/** Which of pause / resume the standing allows, and whether a Claim can be released. */
export interface AgentControls {
  canPause: boolean;
  canResume: boolean;
  canRelease: boolean;
  /** A child agent's capacity follows its parent, so only an agent can be locked. */
  canLock: boolean;
}

/** The hand controls an agent's standing allows. */
export function controlsFor(summary: AgentSummary): AgentControls {
  const claim = summary.agent.claim;
  return {
    canPause: claim !== null && claim.status === "active",
    canResume: claim !== null && claim.status === "paused",
    canRelease: claim !== null,
    canLock: summary.agent.parent_id === null,
  };
}

/** `iso` (a local ISO 8601 time) as a relative phrase ("in 3 hours"), judged against `now`. */
export function relativeTime(iso: string, now: Date, locale?: string): string {
  const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const steps: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["day", 86400], ["hour", 3600], ["minute", 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(seconds, "second");
}

/** `text` with its first letter upper-cased: an account label as a name. */
export function capitalised(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

/** How long ago `iso` was, judged against `now`, in the shortest form ("2h", "5m", "3d"). */
export function shortAge(iso: string, now: Date, locale?: string): string {
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  const steps: Array<[Intl.NumberFormatOptions["unit"], number]> = [
    ["day", 86400], ["hour", 3600], ["minute", 60],
  ];
  const [unit, size] = steps.find(([, step]) => seconds >= step) ?? ["second", 1];
  return new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "narrow" })
    .format(Math.floor(seconds / size));
}
