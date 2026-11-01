import type { RowId } from "@/api/node-id";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";

/**
 * The pending-write lane's data and the pure transitions over it (ADR 0012, decisions 2, 4, 5, 7
 * and 9). No store, no React and no transport: `src/stores/use-pending-writes-store.ts` owns the
 * list and the send closures and calls these.
 */

/**
 * A node's **own** fields: the ones read straight off its stored row. A patch can set only these,
 * so no patch can set a derived value (an inherited Plan or Agentic reading, Timing, Overdue,
 * Resolution, Expired, a Blocked flag, `met`, Archived, Review, a Compound Task's status).
 */
export type OwnFields = Partial<
  Pick<
    MindmapNode,
    | "title"
    | "status"
    | "taskStatus"
    | "verdict"
    | "agentic"
    | "asynchronous"
    | "timeScope"
    | "plan"
    | "dueScope"
    | "onScopeExit"
    | "tagIds"
    | "blockReasons"
    | "delegate"
    | "agenticBrief"
    | "infoDetails"
  >
>;

/** What a created node is drawn as until a board that holds it arrives: its kind and its title. */
export interface PlaceholderNode {
  /** A temporary id (`tmp:<n>`). */
  id: string;
  kind: NodeKind;
  title: string;
}

/** What the board shows meanwhile. */
export type NodePatch =
  | { kind: "fields"; fields: OwnFields }
  | { kind: "create"; parentId: string; afterId: string | null; node: PlaceholderNode };

/** What the server said when it answered a write. */
export interface WriteAnswer {
  /** The window's board-read counter when the answer arrived (decision 5). */
  afterRead: number;
  /** From the write response (Task 9298); `null` where a response has none. */
  epoch: string | null;
  revision: number | null;
  /** The node's own fields as the server wrote them, when the response carries the row. */
  fields: OwnFields | null;
  /** A create's real node id. */
  createdId: string | null;
  /** A create's database row, so a write queued behind it can name the row (decision 8). */
  createdRowId?: RowId;
}

/** One action the board shows before the server has answered it. */
export interface PendingWrite {
  /** Its place in the window's lane; increasing, never reused. */
  seq: number;
  /** The node it touches, by node id: a real one, or a temporary one (decision 8). */
  nodeId: string;
  /** What the board shows meanwhile. */
  patch: NodePatch;
  /** What the user would call it ("rename", "mark done"), for the toast and a local undo. */
  label: string;
  state: "queued" | "sending" | "answered";
  /** Set when the server answered it. */
  answer: WriteAnswer | null;
}

/** The window's pending writes, oldest first. */
export type Lane = readonly PendingWrite[];

/**
 * What a drawn board knows about its own read: which read it was (the window-wide counter, bumped
 * at the start of every read) and the revision it saw. The revision and epoch are `null` in
 * Standalone and before the first load.
 */
export interface BoardStamp {
  read: number;
  epoch: string | null;
  revision: number | null;
}

/** A write as a caller hands it over, before the lane gives it a place. */
export type NewWrite = Pick<PendingWrite, "seq" | "nodeId" | "patch" | "label">;

/**
 * Whether a board stamped `stamp` already shows the write `answer` answered (decision 5). Yes when
 * the board's read began after the answer arrived, which holds in both modes, or when its revision
 * has reached the write's in the same epoch.
 */
export function isReflected(answer: WriteAnswer, stamp: BoardStamp): boolean {
  if (stamp.read > answer.afterRead) return true;
  if (answer.epoch === null || answer.revision === null) return false;
  if (stamp.epoch !== answer.epoch || stamp.revision === null) return false;
  return stamp.revision >= answer.revision;
}

/** Whether the write has not been answered: it is drawn with the cue. */
export function isUnanswered(write: PendingWrite): boolean {
  return write.state !== "answered";
}

/** Whether nothing is waiting to be sent or being sent. Answered writes do not hold the lane. */
export function isDrained(lane: Lane): boolean {
  return lane.every((write) => write.state === "answered");
}

/** Adds a write at the end of the lane, queued. */
export function enqueue(lane: Lane, write: NewWrite): Lane {
  return [...lane, { ...write, state: "queued", answer: null }];
}

/**
 * The write to send now: the oldest queued one, and only when none is in flight (decision 4: one
 * write at a time, in order).
 */
export function nextToSend(lane: Lane): PendingWrite | undefined {
  if (lane.some((write) => write.state === "sending")) return undefined;
  return lane.find((write) => write.state === "queued");
}

function update(lane: Lane, seq: number, change: (write: PendingWrite) => PendingWrite): Lane {
  return lane.map((write) => (write.seq === seq ? change(write) : write));
}

/** Marks a queued write as on its way to the server. */
export function markSending(lane: Lane, seq: number): Lane {
  return update(lane, seq, (write) => (write.state === "queued" ? { ...write, state: "sending" } : write));
}

/** Records the server's answer to the write that was in flight. */
export function markAnswered(lane: Lane, seq: number, answer: WriteAnswer): Lane {
  return update(lane, seq, (write) => (write.state === "sending" ? { ...write, state: "answered", answer } : write));
}

/** The result of a transition that takes writes out of the lane. */
export interface Removal {
  lane: Lane;
  removed: readonly PendingWrite[];
}

/** The node a create goes under, or `null` for a write that is not a create. */
function parentOf(write: PendingWrite): string | null {
  return write.patch.kind === "create" ? write.patch.parentId : null;
}

/**
 * A refusal (decision 7): removes that write and every later write on the same node. When the
 * refused write is a create, a later write on its placeholder, and a later create under that
 * placeholder (with everything on it, recursively), goes too: the placeholder is gone. Writes on
 * other nodes stay. A later write is never in flight (the lane sends in order), so none that is
 * removed has reached the server.
 */
export function refuse(lane: Lane, seq: number): Removal {
  const refused = lane.find((write) => write.seq === seq);
  if (refused === undefined) return { lane, removed: [] };
  const dead = new Set<string>([refused.nodeId]);
  const isCreate = refused.patch.kind === "create";
  const removed: PendingWrite[] = [];
  const kept: PendingWrite[] = [];
  for (const write of lane) {
    const later = write.seq > refused.seq;
    const parent = parentOf(write);
    const dies =
      write.seq === refused.seq ||
      (later && write.state === "queued" && (dead.has(write.nodeId) || (isCreate && parent !== null && dead.has(parent))));
    if (dies) {
      if (write.patch.kind === "create") dead.add(write.nodeId);
      removed.push(write);
    } else kept.push(write);
  }
  return { lane: kept, removed };
}

/** The newest write that `cancelTail` took out, or `null` when it could not. */
export interface Cancelled {
  lane: Lane;
  cancelled: PendingWrite | null;
}

/**
 * Undo's local half (decision 9): when the newest write is still queued, removes it. A write in
 * flight, or already answered, cannot be cancelled, and neither can anything behind it.
 */
export function cancelTail(lane: Lane): Cancelled {
  const newest = lane[lane.length - 1];
  if (newest === undefined || newest.state !== "queued") return { lane, cancelled: null };
  return { lane: lane.slice(0, -1), cancelled: newest };
}

/**
 * The server is unreachable (decision 7): empties the lane of every write the server has not
 * answered. An answered write stays, because the server did write it, and it is retired by the
 * first board read after the server is back.
 */
export function flush(lane: Lane): Removal {
  return {
    lane: lane.filter((write) => write.state === "answered"),
    removed: lane.filter(isUnanswered),
  };
}

/**
 * A create was answered with a real id (decision 8): every later write that names the temporary id
 * now names the real one.
 */
export function resolveTemporary(lane: Lane, seq: number, tempId: string, realId: string): Lane {
  const swap = (id: string): string => (id === tempId ? realId : id);
  return lane.map((write) => {
    if (write.seq <= seq) return write;
    if (write.patch.kind === "fields") return { ...write, nodeId: swap(write.nodeId) };
    const { parentId, afterId, node } = write.patch;
    return {
      ...write,
      nodeId: swap(write.nodeId),
      patch: { kind: "create", parentId: swap(parentId), afterId: afterId === null ? null : swap(afterId), node },
    };
  });
}

/**
 * Forgets the answered writes that every board in `stamps` reflects (decision 6). A write that
 * is not answered is never forgotten.
 */
export function forgetReflected(lane: Lane, stamps: readonly BoardStamp[]): Lane {
  const kept = lane.filter((write) => {
    const { answer } = write;
    return answer === null || !stamps.every((stamp) => isReflected(answer, stamp));
  });
  return kept.length === lane.length ? lane : kept;
}
