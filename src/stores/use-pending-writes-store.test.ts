import { beforeEach, describe, expect, it, vi } from "vitest";
import { afterLane, usePendingWritesStore } from "@/stores/use-pending-writes-store";
import type { IdResolver, WriteResult, WriteSpec } from "@/stores/use-pending-writes-store";

const written = (more: Partial<Extract<WriteResult, { outcome: "written" }>["response"]> = {}): WriteResult => ({
  outcome: "written",
  response: { epoch: "e1", revision: 7, fields: null, createdId: null, ...more },
});

/** A send that stays open until the test settles it. */
function gate() {
  let settle: (result: WriteResult) => void = () => {};
  let fail: (error: unknown) => void = () => {};
  const send = vi.fn(
    (_resolve: IdResolver) => new Promise<WriteResult>((resolve, reject) => { settle = resolve; fail = reject; }),
  );
  return { send, settle: (r: WriteResult) => settle(r), fail: (e: unknown) => fail(e) };
}

function spec(nodeId: string, send: WriteSpec["send"], more: Partial<WriteSpec> = {}): WriteSpec {
  return {
    nodeId, send, label: `edit ${nodeId}`,
    patch: { kind: "fields", fields: { title: nodeId } },
    showToast: vi.fn(), unreachableMessage: "unreachable",
    ...more,
  };
}

const flushPromises = async (): Promise<void> => { await Promise.resolve(); await Promise.resolve(); };
const store = () => usePendingWritesStore.getState();

beforeEach(() => store().reset());

describe("usePendingWritesStore", () => {
  it("sends the writes strictly in order, one at a time", async () => {
    const first = gate();
    const second = gate();
    store().enqueue(spec("a", first.send));
    store().enqueue(spec("b", second.send));
    expect(first.send).toHaveBeenCalledTimes(1);
    expect(second.send).not.toHaveBeenCalled();
    first.settle(written());
    await flushPromises();
    expect(second.send).toHaveBeenCalledTimes(1);
  });

  it("records the answer with the read counter when it arrived", async () => {
    const g = gate();
    store().beginRead();
    store().reportBoard("lagging", { read: 0, epoch: null, revision: null });
    store().enqueue(spec("a", g.send));
    g.settle(written({ fields: { title: "server" } }));
    await flushPromises();
    expect(store().writes[0]).toMatchObject({ state: "answered", answer: { afterRead: 1, revision: 7, fields: { title: "server" } } });
  });

  it("shows one toast per refusal, naming the backend's reason, and goes on with other nodes", async () => {
    const first = gate();
    const other = gate();
    const later = gate();
    const refused = spec("a", first.send);
    store().enqueue(refused);
    store().enqueue(spec("b", other.send));
    store().enqueue(spec("a", later.send));
    first.fail({ kind: "invalid_request", message: "not allowed" });
    await flushPromises();
    expect(refused.showToast).toHaveBeenCalledTimes(1);
    expect(refused.showToast).toHaveBeenCalledWith({ nodeId: "a", message: "not allowed" });
    expect(store().writes.map((w) => w.nodeId)).toEqual(["b"]);
    expect(other.send).toHaveBeenCalledTimes(1);
    expect(later.send).not.toHaveBeenCalled();
  });

  it("treats a gesture's refused outcome as a refusal", async () => {
    const g = gate();
    const refused = spec("a", g.send);
    store().enqueue(refused);
    g.settle({ outcome: "refused", message: "compound" });
    await flushPromises();
    expect(refused.showToast).toHaveBeenCalledWith({ nodeId: "a", message: "compound" });
    expect(store().writes).toEqual([]);
  });

  it("calls the handler of a confirmation refusal and shows no toast", async () => {
    const g = gate();
    const onConfirmation = vi.fn();
    const held = spec("a", g.send, { onConfirmation });
    store().enqueue(held);
    g.fail({ kind: "needs_confirmation", message: "children open" });
    await flushPromises();
    expect(onConfirmation).toHaveBeenCalledTimes(1);
    expect(held.showToast).not.toHaveBeenCalled();
    expect(store().writes).toEqual([]);
  });

  it("flushes the lane when the server is unreachable, with one toast", async () => {
    const g = gate();
    const queued = gate();
    const inFlight = spec("a", g.send);
    const behind = spec("b", queued.send);
    store().enqueue(inFlight);
    store().enqueue(behind);
    g.fail({ kind: "not_permitted", message: "down", details: { reason: "server_unreachable" } });
    await flushPromises();
    expect(store().writes).toEqual([]);
    expect(inFlight.showToast).toHaveBeenCalledTimes(1);
    expect(inFlight.showToast).toHaveBeenCalledWith({ nodeId: "a", message: "unreachable" });
    expect(behind.showToast).not.toHaveBeenCalled();
    expect(queued.send).not.toHaveBeenCalled();
  });

  it("resolves whenDrained when nothing is queued or in flight", async () => {
    const g = gate();
    store().enqueue(spec("a", g.send));
    const drained = vi.fn();
    void store().whenDrained().then(drained);
    await flushPromises();
    expect(drained).not.toHaveBeenCalled();
    g.settle(written());
    await flushPromises();
    expect(drained).toHaveBeenCalled();
  });

  it("resolves whenDrained at once with an empty lane", async () => {
    await expect(store().whenDrained()).resolves.toBeUndefined();
    expect(store().isBusy()).toBe(false);
  });

  it("forgets an answered write once every reported board reflects it", async () => {
    const g = gate();
    store().reportBoard("one", { read: 0, epoch: null, revision: null });
    store().reportBoard("two", { read: 0, epoch: null, revision: null });
    store().enqueue(spec("a", g.send));
    g.settle(written({ epoch: null, revision: null }));
    await flushPromises();
    expect(store().writes).toHaveLength(1);
    const read = store().beginRead();
    store().reportBoard("one", { read, epoch: null, revision: null });
    expect(store().writes).toHaveLength(1);
    store().reportBoard("two", { read, epoch: null, revision: null });
    expect(store().writes).toHaveLength(0);
  });

  it("lets go of a write when the one board that lagged behind it is gone", async () => {
    const g = gate();
    store().reportBoard("one", { read: 0, epoch: null, revision: null });
    store().enqueue(spec("a", g.send));
    g.settle(written({ epoch: null, revision: null }));
    await flushPromises();
    store().forgetBoard("one");
    expect(store().writes).toHaveLength(0);
  });

  it("cancels the newest write when it is queued, and never one in flight", () => {
    const g = gate();
    store().enqueue(spec("a", g.send));
    expect(store().cancelTail()).toBeNull();
    const queued = gate();
    store().enqueue(spec("b", queued.send));
    expect(store().cancelTail()).toEqual({ label: "edit b" });
    expect(store().writes.map((w) => w.nodeId)).toEqual(["a"]);
  });

  it("rewrites a temporary id after the create is answered and remembers the alias", async () => {
    const create = gate();
    const rename = gate();
    store().reportBoard("lagging", { read: 0, epoch: null, revision: null });
    const tempId = store().nextTemporaryId();
    store().enqueue({
      ...spec(tempId, create.send),
      patch: { kind: "create", parentId: "p", afterId: null, node: { id: tempId, kind: "task", title: "n" } },
    });
    store().enqueue(spec(tempId, (resolve) => rename.send(resolve)));
    create.settle(written({ createdId: "task-9" }));
    await flushPromises();
    expect(store().resolveId(tempId)).toBe("task-9");
    expect(store().writes.find((w) => w.seq === 2)?.nodeId).toBe("task-9");
    expect(rename.send).toHaveBeenCalledWith(store().resolveId);
  });

  it("counts a rollback, so undo can tell the write it waited for was refused", async () => {
    const g = gate();
    store().enqueue(spec("a", g.send));
    g.fail({ kind: "invalid_request", message: "no" });
    await flushPromises();
    expect(store().rollbacks).toBe(1);
  });
});

describe("a write that asks to be told it was rolled back", () => {
  it("is told the reason of its own refusal, and the toast is worded by the write", async () => {
    const g = gate();
    const showToast = vi.fn();
    const onRolledBack = vi.fn();
    store().enqueue(spec("a", g.send, {
      showToast, onRolledBack, refusalToast: (reason) => `Couldn't save: ${reason}`,
    }));
    g.fail(new Error("no way"));
    await flushPromises();
    expect(showToast).toHaveBeenCalledWith({ nodeId: "a", message: "Couldn't save: no way" });
    expect(onRolledBack).toHaveBeenCalledWith("no way");
  });

  it("is told too when a write ahead of it on the node was refused and it was never sent", async () => {
    const g = gate();
    const second = gate();
    const onRolledBack = vi.fn();
    store().enqueue(spec("a", g.send));
    store().enqueue(spec("a", second.send, { onRolledBack }));
    g.fail(new Error("no way"));
    await flushPromises();
    expect(second.send).not.toHaveBeenCalled();
    expect(onRolledBack).toHaveBeenCalledWith("no way");
  });

  it("is told the unreachable notice when the lane is flushed, and not for a held confirmation", async () => {
    const g = gate();
    const onRolledBack = vi.fn();
    store().enqueue(spec("a", g.send, { onRolledBack }));
    g.fail({ kind: "not_permitted", message: "down", details: { reason: "server_unreachable" } });
    await flushPromises();
    expect(onRolledBack).toHaveBeenCalledWith("unreachable");

    const h = gate();
    const quiet = vi.fn();
    store().enqueue(spec("b", h.send, { onRolledBack: quiet, onConfirmation: vi.fn() }));
    h.fail({ kind: "needs_confirmation", message: "sure?" });
    await flushPromises();
    expect(quiet).not.toHaveBeenCalled();
  });
});

describe("afterLane", () => {
  it("runs at once with the lane empty, and after it drains otherwise", async () => {
    const run = vi.fn(() => Promise.resolve("ok"));
    void afterLane(run);
    expect(run).toHaveBeenCalledTimes(1);

    const g = gate();
    store().enqueue(spec("a", g.send));
    const waiting = vi.fn(() => Promise.resolve("later"));
    void afterLane(waiting);
    await flushPromises();
    expect(waiting).not.toHaveBeenCalled();
    g.settle(written());
    await flushPromises();
    expect(waiting).toHaveBeenCalledTimes(1);
  });
});
