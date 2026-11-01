import { describe, expect, it } from "vitest";
import { applyPendingWrites } from "@/utils/apply-pending-writes";
import type { BoardStamp, OwnFields, PendingWrite, WriteAnswer } from "@/utils/pending-writes";
import type { MindmapNode } from "@/utils/tree-layout";

function node(id: string, children: MindmapNode[] = [], more: Partial<MindmapNode> = {}): MindmapNode {
  return { id, kind: "task", title: id, position: 0, tagIds: [], children, ...more };
}

const board = node("root", [
  node("a", [node("a1"), node("a2")], { status: "todo" }),
  node("b", [node("b1")]),
]);
const stamp: BoardStamp = { read: 1, epoch: "e1", revision: 5 };
const none = new Map<string, string>();

function fields(seq: number, nodeId: string, f: OwnFields, over: Partial<PendingWrite> = {}): PendingWrite {
  return { seq, nodeId, patch: { kind: "fields", fields: f }, label: "x", state: "sending", answer: null, ...over };
}

function answered(over: Partial<WriteAnswer> = {}): WriteAnswer {
  return { afterRead: 1, epoch: "e1", revision: 6, fields: null, createdId: null, ...over };
}

function child(root: MindmapNode, ...path: string[]): MindmapNode | undefined {
  return path.reduce<MindmapNode | undefined>((n, id) => n?.children.find((c) => c.id === id), root);
}

describe("applyPendingWrites", () => {
  it("returns the board itself when there is nothing to draw", () => {
    expect(applyPendingWrites(board, stamp, [], none)).toBe(board);
  });

  it("changes only its node, only the fields it names, and shares the rest", () => {
    const out = applyPendingWrites(board, stamp, [fields(1, "a1", { title: "renamed" })], none);
    expect(child(out, "a", "a1")).toMatchObject({ title: "renamed", pending: true });
    expect(child(out, "a", "a2")).toBe(child(board, "a", "a2"));
    expect(child(out, "b")).toBe(child(board, "b"));
    expect(out).not.toBe(board);
    expect(child(board, "a", "a1")?.title).toBe("a1");
  });

  it("applies the patches in seq order, whatever order they come in", () => {
    const out = applyPendingWrites(
      board, stamp,
      [fields(2, "a", { status: "done" }), fields(1, "a", { status: "doing" })],
      none,
    );
    expect(child(out, "a")?.status).toBe("done");
  });

  it("drops an answered write whose answer a later read reflects", () => {
    const write = fields(1, "a", { title: "x" }, { state: "answered", answer: answered({ afterRead: 1 }) });
    expect(applyPendingWrites(board, { ...stamp, read: 2 }, [write], none)).toBe(board);
  });

  it("drops an answered write the board's revision has reached, in the same epoch", () => {
    const write = fields(1, "a", { title: "x" }, { state: "answered", answer: answered({ afterRead: 7 }) });
    expect(applyPendingWrites(board, { ...stamp, revision: 6 }, [write], none)).toBe(board);
  });

  it("keeps an answered write no board reflects yet, without the cue", () => {
    const write = fields(1, "a", { title: "x" }, { state: "answered", answer: answered({ afterRead: 7 }) });
    const out = applyPendingWrites(board, stamp, [write], none);
    expect(child(out, "a")?.title).toBe("x");
    expect(child(out, "a")?.pending).toBeUndefined();
  });

  it("replaces the predicted fields with the server's own", () => {
    const write = fields(1, "a", { title: "predicted" }, {
      state: "answered", answer: answered({ afterRead: 7, fields: { title: "server's" } }),
    });
    expect(child(applyPendingWrites(board, stamp, [write], none), "a")?.title).toBe("server's");
  });

  it("skips a patch for a node that is not on the board", () => {
    expect(applyPendingWrites(board, stamp, [fields(1, "gone", { title: "x" })], none)).toBe(board);
  });

  it("marks pending only while a write on the node is unanswered", () => {
    const out = applyPendingWrites(board, stamp, [
      fields(1, "a", { title: "x" }, { state: "answered", answer: answered({ afterRead: 7 }) }),
      fields(2, "b", { title: "y" }, { state: "queued" }),
    ], none);
    expect(child(out, "a")?.pending).toBeUndefined();
    expect(child(out, "b")?.pending).toBe(true);
  });

  it("inserts a placeholder after the sibling, or last", () => {
    const place = (seq: number, id: string, afterId: string | null): PendingWrite => ({
      seq, nodeId: id, label: "create", state: "queued", answer: null,
      patch: { kind: "create", parentId: "a", afterId, node: { id, kind: "task", title: id } },
    });
    const out = applyPendingWrites(board, stamp, [place(1, "tmp:1", "a1"), place(2, "tmp:2", null)], none);
    expect(child(out, "a")?.children.map((c) => c.id)).toEqual(["a1", "tmp:1", "a2", "tmp:2"]);
    expect(child(out, "a", "tmp:1")).toMatchObject({ pending: true, title: "tmp:1", children: [] });
  });

  it("finds a node written to by its temporary id once the create has a real one", () => {
    const create: PendingWrite = {
      seq: 1, nodeId: "tmp:1", label: "create", state: "answered",
      answer: answered({ afterRead: 7, createdId: "task-9" }),
      patch: { kind: "create", parentId: "a", afterId: null, node: { id: "tmp:1", kind: "task", title: "n" } },
    };
    const out = applyPendingWrites(board, stamp, [create, fields(2, "tmp:1", { title: "later" }, { state: "queued" })], none);
    expect(child(out, "a", "task-9")).toMatchObject({ title: "later", pending: true });
  });

  it("does not insert a created node twice once a board holds it", () => {
    const withReal = node("root", [node("a", [node("task-9")])]);
    const create: PendingWrite = {
      seq: 1, nodeId: "tmp:1", label: "create", state: "answered",
      answer: answered({ afterRead: 7, createdId: "task-9" }),
      patch: { kind: "create", parentId: "a", afterId: null, node: { id: "tmp:1", kind: "task", title: "n" } },
    };
    expect(applyPendingWrites(withReal, stamp, [create], none)).toBe(withReal);
  });
});
