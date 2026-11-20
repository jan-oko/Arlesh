import { ARLESH_NODE_NAMESPACE } from "@/utils/node-uuid";
import { uuidV5 } from "@/utils/uuid-v5";

/**
 * The id a stored row had before row identity moved from integers to UUIDs (ADR 0017, decision 9):
 * `uuidV5("{kind}:{integer}")` under the node namespace, which is exactly the id the row has now.
 * `kind` is the node kind's spelling — `domain` for every aspect, project, domain and tag row.
 */
export function legacyStoredId(kind: string, integer: number): string {
  return uuidV5(`${kind}:${integer}`, ARLESH_NODE_NAMESPACE);
}

/** The display-key prefix of each stored kind, and the kind spelling its old full id was hashed under. */
const PREFIX_KIND: Readonly<Record<string, string>> = {
  domain: "domain",
  goal: "goal",
  task: "task",
  commitment: "commitment",
  info: "info",
  flow: "flow",
  flowgoal: "flow_goal",
  flowtask: "flow_task",
  flowcommitment: "flow_commitment",
  flowexpectation: "flow_expectation",
};

const INTEGER_KEY = /^([a-z]+)-(\d+)$/;
const HABIT_RUN_KEY = /^habitrun-(\d+)-((?:virtual|(?:day|week|month|season|year|part)-.*))$/;

/**
 * A node's display key as a saved tab spelled it before the move (`task-12`, `habitrun-5-…-virtual`),
 * rewritten to the key the same row has now (`task-<uuid>`). Any other string — already a UUID
 * key, a minted Expectation key, `root` — comes back unchanged. A minted Expectation key hashed
 * the integer and cannot be recovered; a saved one falls back to the root as any stale key does.
 */
export function upgradeSavedNodeKey(key: string): string {
  const habitRun = HABIT_RUN_KEY.exec(key);
  if (habitRun?.[1] !== undefined && habitRun[2] !== undefined) {
    return `habitrun-${legacyStoredId("flow", Number(habitRun[1]))}-${habitRun[2]}`;
  }
  const plain = INTEGER_KEY.exec(key);
  const prefix = plain?.[1];
  const kind = prefix === undefined ? undefined : PREFIX_KIND[prefix];
  if (prefix === undefined || kind === undefined || plain?.[2] === undefined) return key;
  return `${prefix}-${legacyStoredId(kind, Number(plain[2]))}`;
}

/** A saved tag id: an integer is the old row id of a tag; a string is already a UUID. */
export function upgradeSavedTagId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isInteger(value)) return legacyStoredId("domain", value);
  return null;
}
