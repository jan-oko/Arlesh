import type { AgentActivityCounts, MindmapLoad, NodeFacts } from "@/api/mindmap";

/**
 * Applying a change event to the board a window holds, and the digest that proves the window holds
 * what the producer published (ADR 0020).
 *
 * Pure: no store, no event, no Tauri. A change can come from a server's stream, from the desktop's
 * own publisher or, one day, from a local replica (Task `ccc`); this module does not care which.
 *
 * The board is cut into **entries**: a row, a group of rows, or a map entry, each under a key the
 * producer computes the same way (`crates/arlesh-core/src/mindmap/rules/changes.rs`). A change names
 * entries by key: `set` carries `[key, value]` pairs (an addition or a replacement) and `del` carries
 * keys. There is no move: a moved row is the row set again, because the rows carry their own parent
 * and position.
 */

/** Every collection the board travels in: the {@link MindmapLoad} fields that are entries. */
export const COLLECTIONS = [
  "domains",
  "goals",
  "tasks",
  "commitments",
  "expectations",
  "infos",
  "flows",
  "flow_goals",
  "flow_tasks",
  "flow_commitments",
  "flow_expectations",
  "flow_cycles",
  "flow_dependencies",
  "block_reasons",
  "task_dependencies",
  "flow_instance_nodes",
  "lifecycles",
  "habits",
  "short_ids",
  "facts",
  "agent_activity",
] as const;

export type CollectionName = (typeof COLLECTIONS)[number];

/** Collections whose entry is one row of an array. */
type RowCollection = Exclude<CollectionName, "block_reasons" | "task_dependencies" | "short_ids" | "facts" | "agent_activity">;

/** Collections whose entry is all the rows of one owner, in board order. */
type GroupCollection = "block_reasons" | "task_dependencies";

/** Collections that are a map from key to value. */
type MapCollection = "short_ids" | "facts";

/** What changed in one collection: entries added or replaced by key, and keys gone. */
export interface CollectionChanges {
  set: ReadonlyArray<readonly [string, unknown]>;
  del: readonly string[];
}

/** What changed on the board, by collection. Collections that did not change are absent. */
export type BoardChanges = Partial<Record<CollectionName, CollectionChanges>>;

/** One entry of the board. */
export interface BoardEntry {
  collection: CollectionName;
  key: string;
  value: unknown;
}

/**
 * The digest of every entry a window holds, and their order-free sums.
 *
 * `byEntry` is keyed `"<collection>\0<key>"`; `sums` holds each collection's sum and `total` the sum
 * of everything, wrapping at 2^32. A window keeps these with its board so that it checks every event
 * in time proportional to what changed.
 */
export interface BoardDigests {
  byEntry: ReadonlyMap<string, number>;
  sums: Readonly<Record<string, number>>;
  total: number;
}

/** The board a window holds, with the digests of what it holds. */
export interface HeldBoard {
  load: MindmapLoad;
  digests: BoardDigests;
}

const ROW_COLLECTIONS: ReadonlySet<string> = new Set<RowCollection>([
  "domains",
  "goals",
  "tasks",
  "commitments",
  "expectations",
  "infos",
  "flows",
  "flow_goals",
  "flow_tasks",
  "flow_commitments",
  "flow_expectations",
  "flow_cycles",
  "flow_dependencies",
  "flow_instance_nodes",
  "lifecycles",
  "habits",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function field(item: unknown, name: string): string {
  if (!isRecord(item)) throw new Error(`a board entry is not an object: ${JSON.stringify(item)}`);
  const value = item[name];
  if (typeof value === "string" || typeof value === "number") return String(value);
  throw new Error(`a board entry has no \`${name}\`: ${JSON.stringify(item)}`);
}

/**
 * The key of one row of `collection`: its id, the board key (`task-12`) for the nodes the board
 * keys by kind, `<node_type>-<node_id>` for lifecycles and instance nodes, the flow's id for a habit.
 * For a row of a group collection, the key of the group it belongs to.
 */
export function keyOf(collection: Exclude<CollectionName, MapCollection | "agent_activity">, item: unknown): string {
  switch (collection) {
    case "tasks":
      return `task-${field(item, "id")}`;
    case "goals":
      return `goal-${field(item, "id")}`;
    case "commitments":
      return `commitment-${field(item, "id")}`;
    case "expectations":
      return `expectation-${field(item, "id")}`;
    case "lifecycles":
    case "flow_instance_nodes":
      return `${field(item, "node_type")}-${field(item, "node_id")}`;
    case "habits":
      return field(item, "flow_id");
    case "block_reasons":
      return `${field(item, "owner_type")}-${field(item, "owner_id")}`;
    case "task_dependencies":
      return `task-${field(item, "task_id")}`;
    default:
      return field(item, "id");
  }
}

function rowsOf(load: MindmapLoad, collection: RowCollection | GroupCollection): readonly unknown[] {
  return load[collection];
}

/** Every entry of `load`, grouping block reasons by owner and dependencies by Task in board order. */
export function entriesOf(load: MindmapLoad): BoardEntry[] {
  const entries: BoardEntry[] = [];
  for (const collection of COLLECTIONS) {
    if (isRowCollection(collection)) {
      for (const row of rowsOf(load, collection)) entries.push({ collection, key: keyOf(collection, row), value: row });
    } else if (isGroupCollection(collection)) {
      const groups = new Map<string, unknown[]>();
      for (const row of rowsOf(load, collection)) {
        const key = keyOf(collection, row);
        const group = groups.get(key);
        if (group === undefined) groups.set(key, [row]);
        else group.push(row);
      }
      for (const [key, value] of groups) entries.push({ collection, key, value });
    } else if (isMapCollection(collection)) {
      for (const [key, value] of Object.entries(load[collection] ?? {})) entries.push({ collection, key, value });
    } else if (load.agent_activity !== undefined) {
      entries.push({ collection, key: "agent_activity", value: load.agent_activity });
    }
  }
  return entries;
}

function isRowCollection(collection: CollectionName): collection is RowCollection {
  return ROW_COLLECTIONS.has(collection);
}

function isGroupCollection(collection: CollectionName): collection is GroupCollection {
  return collection === "block_reasons" || collection === "task_dependencies";
}

function isMapCollection(collection: CollectionName): collection is MapCollection {
  return collection === "short_ids" || collection === "facts";
}

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const encoder = new TextEncoder();

/**
 * The digest of one entry: FNV-1a 32 over the UTF-8 bytes of `collection`, a zero byte, `key`, a
 * zero byte and the entry's compact JSON. The same function the producer runs in Rust.
 */
export function entryDigest(collection: CollectionName, key: string, value: unknown): number {
  return digestOfJson(collection, key, compactJson(value));
}

const BIGGEST_I64 = "9223372036854775807";

/**
 * The compact JSON of `value` as the producer writes it. `JSON.stringify` agrees with it for every
 * value but an integer past 2^53, which the producer writes in full and JavaScript rounds: a derived
 * check Task's `position` is the least `i64`, `-9223372036854775808`, and prints as
 * `-9223372036854776000`. Those are written as the whole integer here. (A number the parse has
 * already rounded is exact only for a power of two such as that one; the greatest `i64` parses to
 * 2^63 and is named by its own digits.)
 */
export function compactJson(value: unknown): string {
  const plain = JSON.stringify(value);
  // A number past 2^53 has sixteen digits or more; nothing else on a board has a run that long.
  return /\d{16}/.test(plain) ? writeExactIntegers(value) : plain;
}

function writeExactIntegers(value: unknown): string {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || Math.abs(value) < Number.MAX_SAFE_INTEGER) return JSON.stringify(value);
    return value >= 2 ** 63 ? BIGGEST_I64 : BigInt(value).toString();
  }
  if (Array.isArray(value)) return `[${value.map((item: unknown) => writeExactIntegers(item)).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const members = Object.entries(value)
      .filter(([, member]) => member !== undefined)
      .map(([key, member]) => `${JSON.stringify(key)}:${writeExactIntegers(member)}`);
    return `{${members.join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The digest of an entry whose compact JSON is already in hand. */
export function digestOfJson(collection: CollectionName, key: string, json: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (const byte of encoder.encode(`${collection}\0${key}\0${json}`)) {
    hash = Math.imul(hash ^ byte, FNV_PRIME);
  }
  return hash >>> 0;
}

function entryId(collection: CollectionName, key: string): string {
  return `${collection}\0${key}`;
}

/** The digests of every entry of `load`. */
export function digestsOf(load: MindmapLoad): BoardDigests {
  const byEntry = new Map<string, number>();
  const sums: Record<string, number> = {};
  let total = 0;
  for (const { collection, key, value } of entriesOf(load)) {
    const digest = entryDigest(collection, key, value);
    byEntry.set(entryId(collection, key), digest);
    sums[collection] = ((sums[collection] ?? 0) + digest) >>> 0;
    total = (total + digest) >>> 0;
  }
  return { byEntry, sums, total };
}

/** A board as a window takes it in: the load, with the digest of every entry in it. */
export function indexBoard(load: MindmapLoad): HeldBoard {
  return { load, digests: digestsOf(load) };
}

/** The board hash of `load`, worked out again from the values held rather than a running sum. */
export function recomputeHash(load: MindmapLoad): number {
  return digestsOf(load).total;
}

/** The collections whose sums differ between two sets of sums, in board order. */
export function differingCollections(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): string[] {
  return COLLECTIONS.filter((collection) => (a[collection] ?? 0) !== (b[collection] ?? 0));
}

/** Rows with `set` entries put in their place and `del` entries dropped: a new entry is appended. */
function applyRows(
  collection: RowCollection,
  rows: readonly unknown[],
  changes: CollectionChanges,
): unknown[] {
  const gone = new Set(changes.del);
  const replacements = new Map(changes.set);
  const next: unknown[] = [];
  const placed = new Set<string>();
  for (const row of rows) {
    const key = keyOf(collection, row);
    if (gone.has(key) && !replacements.has(key)) continue;
    if (replacements.has(key)) {
      next.push(replacements.get(key));
      placed.add(key);
    } else next.push(row);
  }
  for (const [key, value] of changes.set) if (!placed.has(key)) next.push(value);
  return next;
}

/** A group collection's rows with each changed owner's rows replaced whole, at the owner's place. */
function applyGroups(
  collection: GroupCollection,
  rows: readonly unknown[],
  changes: CollectionChanges,
): unknown[] {
  const gone = new Set(changes.del);
  const replacements = new Map(changes.set);
  const next: unknown[] = [];
  const placed = new Set<string>();
  for (const row of rows) {
    const key = keyOf(collection, row);
    if (replacements.has(key)) {
      if (!placed.has(key)) {
        placed.add(key);
        const group: unknown = replacements.get(key);
        if (Array.isArray(group)) next.push(...group);
      }
    } else if (!gone.has(key)) next.push(row);
  }
  for (const [key, group] of changes.set) {
    if (!placed.has(key) && Array.isArray(group)) next.push(...group);
  }
  return next;
}

/** A map collection with its entries set and dropped. `fits` says whether a value is one the map holds. */
function applyMap<T>(
  held: Readonly<Record<string, T>> | undefined,
  changes: CollectionChanges,
  fits: (value: unknown) => value is T,
): Record<string, T> {
  const next: Record<string, T> = { ...(held ?? {}) };
  for (const key of changes.del) delete next[key];
  for (const [key, value] of changes.set) if (fits(value)) next[key] = value;
  return next;
}

function isShortId(value: unknown): value is string {
  return typeof value === "string";
}

function isNodeFacts(value: unknown): value is NodeFacts {
  return isRecord(value);
}

function isAgentActivity(value: unknown): value is AgentActivityCounts {
  return isRecord(value) && typeof value["review"] === "number";
}

/**
 * The board after `changes`: a replaced entry keeps its place, a new one is appended, a deleted one
 * is dropped, and collections with no changes keep their identity. The digests follow from what is
 * applied. Nothing on the client may depend on a collection's order except through a field (a
 * position, `flow_id`): a fresh load puts rows back in the producer's order.
 */
export function applyBoardChanges(held: HeldBoard, changes: BoardChanges): HeldBoard {
  const load: MindmapLoad = { ...held.load };
  const byEntry = new Map(held.digests.byEntry);
  const sums: Record<string, number> = { ...held.digests.sums };
  let total = held.digests.total;

  const retire = (collection: CollectionName, key: string): void => {
    const id = entryId(collection, key);
    const old = byEntry.get(id);
    if (old === undefined) return;
    byEntry.delete(id);
    sums[collection] = ((sums[collection] ?? 0) - old) >>> 0;
    total = (total - old) >>> 0;
  };
  const admit = (collection: CollectionName, key: string, value: unknown): void => {
    const digest = entryDigest(collection, key, value);
    byEntry.set(entryId(collection, key), digest);
    sums[collection] = ((sums[collection] ?? 0) + digest) >>> 0;
    total = (total + digest) >>> 0;
  };

  for (const collection of COLLECTIONS) {
    const change = changes[collection];
    if (change === undefined) continue;
    for (const key of change.del) retire(collection, key);
    for (const [key] of change.set) retire(collection, key);
    for (const [key, value] of change.set) admit(collection, key, value);
    if (isRowCollection(collection)) {
      Object.assign(load, { [collection]: applyRows(collection, load[collection], change) });
    } else if (isGroupCollection(collection)) {
      Object.assign(load, { [collection]: applyGroups(collection, load[collection], change) });
    } else if (collection === "short_ids") {
      load.short_ids = applyMap(load.short_ids, change, isShortId);
    } else if (collection === "facts") {
      load.facts = applyMap(load.facts, change, isNodeFacts);
    } else {
      const last = change.set[change.set.length - 1];
      if (last !== undefined && isAgentActivity(last[1])) load.agent_activity = last[1];
      else delete load.agent_activity;
    }
  }
  return { load, digests: { byEntry, sums, total } };
}
