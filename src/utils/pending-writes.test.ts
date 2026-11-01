import { describe, expect, it } from "vitest";
import {
  cancelTail,
  enqueue,
  flush,
  forgetReflected,
  isDrained,
  isReflected,
  markAnswered,
  markSending,
  nextToSend,
  refuse,
  resolveTemporary,
} from "@/utils/pending-writes";
import type { Lane, NewWrite, WriteAnswer } from "@/utils/pending-writes";

function rename(seq: number, nodeId: string): NewWrite {
  return { seq, nodeId, patch: { kind: "fields", fields: { title: `t${seq}` } }, label: "rename" };
}

function create(seq: number, tempId: string, parentId: string): NewWrite {
  return {
    seq,
    nodeId: tempId,
    patch: { kind: "create", parentId, afterId: null, node: { id: tempId, kind: "task", title: "new" } },
    label: "create",
  };
}

function laneOf(...writes: NewWrite[]): Lane {
  return writes.reduce<Lane>((lane, write) => enqueue(lane, write), []);
}

const answer: WriteAnswer = { afterRead: 3, epoch: "e1", revision: 10, fields: null, createdId: null };

describe("the lane's reducer", () => {
  it("sends one write at a time, oldest first", () => {
    let lane = laneOf(rename(1, "a"), rename(2, "b"));
    expect(nextToSend(lane)?.seq).toBe(1);
    lane = markSending(lane, 1);
    expect(nextToSend(lane)).toBeUndefined();
    lane = markAnswered(lane, 1, answer);
    expect(nextToSend(lane)?.seq).toBe(2);
  });

  it("is drained when nothing is queued or in flight, answered writes aside", () => {
    let lane = laneOf(rename(1, "a"));
    expect(isDrained(lane)).toBe(false);
    lane = markAnswered(markSending(lane, 1), 1, answer);
    expect(isDrained(lane)).toBe(true);
  });

  it("removes a refused write and every later one on the same node, and leaves others", () => {
    const lane = markSending(laneOf(rename(1, "a"), rename(2, "b"), rename(3, "a")), 1);
    const { lane: after, removed } = refuse(lane, 1);
    expect(removed.map((w) => w.seq)).toEqual([1, 3]);
    expect(after.map((w) => w.seq)).toEqual([2]);
  });

  it("takes a refused create's placeholder with everything on it and under it", () => {
    const lane = markSending(
      laneOf(create(1, "tmp:1", "p"), rename(2, "tmp:1"), create(3, "tmp:2", "tmp:1"), rename(4, "tmp:2"), rename(5, "p")),
      1,
    );
    const { lane: after } = refuse(lane, 1);
    expect(after.map((w) => w.seq)).toEqual([5]);
  });

  it("cancels a queued newest write", () => {
    const { lane, cancelled } = cancelTail(laneOf(rename(1, "a"), rename(2, "b")));
    expect(cancelled?.seq).toBe(2);
    expect(lane.map((w) => w.seq)).toEqual([1]);
  });

  it("cannot cancel a write in flight, or an answered one", () => {
    const sending = markSending(laneOf(rename(1, "a")), 1);
    expect(cancelTail(sending).cancelled).toBeNull();
    expect(cancelTail(markAnswered(sending, 1, answer)).cancelled).toBeNull();
    expect(cancelTail([]).cancelled).toBeNull();
  });

  it("flushes every unanswered write", () => {
    let lane = laneOf(rename(1, "a"), rename(2, "b"), rename(3, "c"));
    lane = markAnswered(markSending(lane, 1), 1, answer);
    lane = markSending(lane, 2);
    const { lane: after, removed } = flush(lane);
    expect(removed.map((w) => w.seq)).toEqual([2, 3]);
    expect(after.map((w) => w.seq)).toEqual([1]);
  });

  it("flushing a lane with nothing answered empties it", () => {
    expect(flush(laneOf(rename(1, "a"), rename(2, "b"))).lane).toEqual([]);
  });

  it("rewrites a temporary id in the writes behind its create", () => {
    const lane = resolveTemporary(laneOf(create(1, "tmp:1", "p"), rename(2, "tmp:1"), create(3, "tmp:2", "tmp:1")), 1, "tmp:1", "task-9");
    expect(lane[0]?.nodeId).toBe("tmp:1");
    expect(lane[1]?.nodeId).toBe("task-9");
    expect(lane[2]?.patch).toMatchObject({ parentId: "task-9" });
  });
});

describe("isReflected", () => {
  it("holds when the board's read began after the answer, in either mode", () => {
    expect(isReflected({ ...answer, epoch: null, revision: null }, { read: 4, epoch: null, revision: null })).toBe(true);
    expect(isReflected({ ...answer, epoch: null, revision: null }, { read: 3, epoch: null, revision: null })).toBe(false);
  });

  it("holds when the board's revision has reached the write's in the same epoch", () => {
    expect(isReflected(answer, { read: 1, epoch: "e1", revision: 10 })).toBe(true);
    expect(isReflected(answer, { read: 1, epoch: "e1", revision: 9 })).toBe(false);
  });

  it("compares revisions only within one epoch", () => {
    expect(isReflected(answer, { read: 1, epoch: "e2", revision: 99 })).toBe(false);
  });
});

describe("forgetReflected", () => {
  it("forgets an answered write only when every board reflects it", () => {
    const lane = markAnswered(markSending(laneOf(rename(1, "a")), 1), 1, answer);
    const caughtUp = { read: 9, epoch: null, revision: null };
    const behind = { read: 1, epoch: null, revision: null };
    expect(forgetReflected(lane, [caughtUp, behind])).toHaveLength(1);
    expect(forgetReflected(lane, [caughtUp, caughtUp])).toHaveLength(0);
  });

  it("never forgets a write that is not answered", () => {
    expect(forgetReflected(laneOf(rename(1, "a")), [{ read: 99, epoch: null, revision: null }])).toHaveLength(1);
  });
});
