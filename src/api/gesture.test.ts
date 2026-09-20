import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { gestureName, invoke, redo, undo, undoStatus, withGesture } from "./gesture";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

/** What the fake backend saw, from the point of view of the undo stack. */
interface Backend {
  /** The Gesture each non-protocol command belonged to, in order. `null` = none was open. */
  gestureOf: Array<string | null>;
  /** How many Gestures were actually started — an open over a running one joins it instead. */
  started: number;
  /** How many closes came back, so an unbalanced open is visible. */
  closed: number;
  /** Every command issued, protocol included. */
  commands: string[];
  /** The ids of the Gestures this test started, in order. */
  ids: string[];
}

// Gesture ids are minted by the database and never repeat within a session, so they must not
// repeat across tests either: the name registry is module state that outlives one test.
let nextGestureNumber = 1;

/**
 * Stands in for `open_gesture` / `close_gesture` with the nesting the real ones have: an open over
 * a running Gesture joins it and only the outermost close ends it. Everything the frontend claims
 * about grouping rests on that, so the fake has to model it rather than count calls.
 */
function installBackend(options: { openFails?: boolean; failCommand?: string } = {}): Backend {
  const backend: Backend = { gestureOf: [], started: 0, closed: 0, commands: [], ids: [] };
  let depth = 0;
  let current: string | null = null;

  vi.mocked(tauriInvoke).mockImplementation((command: string) => {
    backend.commands.push(command);
    if (command === "open_gesture") {
      if (options.openFails === true) return Promise.reject(new Error("no gesture"));
      depth += 1;
      if (depth === 1) {
        backend.started += 1;
        current = `gesture-${nextGestureNumber}`;
        nextGestureNumber += 1;
        backend.ids.push(current);
      }
      return Promise.resolve(current);
    }
    if (command === "close_gesture") {
      backend.closed += 1;
      depth -= 1;
      if (depth === 0) current = null;
      return Promise.resolve(null);
    }
    backend.gestureOf.push(current);
    if (command === options.failCommand) return Promise.reject(new Error("command blew up"));
    return Promise.resolve("done");
  });

  return backend;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("invoke", () => {
  it("gives a command issued outside a gesture a gesture of its own", async () => {
    const backend = installBackend();

    await invoke("create_task");
    await invoke("create_goal");

    expect(backend.started).toBe(2);
    expect(backend.gestureOf).toEqual(backend.ids);
    expect(backend.ids[0]).not.toBe(backend.ids[1]);
    expect(backend.closed).toBe(2);
  });

  it("forwards a command with no arguments as a one-argument call", async () => {
    installBackend();

    await invoke("list_tasks");

    expect(tauriInvoke).toHaveBeenCalledWith("list_tasks");
  });

  it("forwards the arguments it was given", async () => {
    installBackend();

    await invoke("update_task", { id: 4, request: { title: "x" } });

    expect(tauriInvoke).toHaveBeenCalledWith("update_task", { id: 4, request: { title: "x" } });
  });

  it("closes the gesture when the command rejects, and lets the rejection through", async () => {
    const backend = installBackend({ failCommand: "delete_task" });

    await expect(invoke("delete_task")).rejects.toThrow("command blew up");

    // The write may already have happened; an unclosed gesture would swallow every later write.
    expect(backend.closed).toBe(1);
  });

  it("runs the command anyway when the gesture cannot be opened", async () => {
    const backend = installBackend({ openFails: true });

    await expect(invoke("create_task")).resolves.toBe("done");

    expect(backend.gestureOf).toEqual([null]);
    expect(backend.closed).toBe(0);
  });
});

describe("withGesture", () => {
  it("puts every command it wraps in one gesture", async () => {
    const backend = installBackend();

    await withGesture("paste 3 nodes", async () => {
      await invoke("duplicate_task");
      await invoke("duplicate_task");
      await invoke("duplicate_task");
    });

    expect(backend.started).toBe(1);
    expect(new Set(backend.gestureOf)).toEqual(new Set(backend.ids));
    expect(backend.gestureOf).toHaveLength(3);
  });

  it("lets the next command outside it start a new gesture", async () => {
    const backend = installBackend();

    await withGesture("paste 2 nodes", async () => {
      await invoke("duplicate_task");
      await invoke("duplicate_task");
    });
    await invoke("update_task");

    const [paste, laterEdit] = backend.ids;
    expect(backend.gestureOf).toEqual([paste, paste, laterEdit]);
  });

  it("closes the gesture when a command inside it throws, and rethrows", async () => {
    const backend = installBackend({ failCommand: "duplicate_goal" });

    await expect(
      withGesture("paste 2 nodes", async () => {
        await invoke("duplicate_task");
        await invoke("duplicate_goal");
      }),
    ).rejects.toThrow("command blew up");

    // A paste that fails halfway is still one thing that happened and still one thing to undo.
    expect(backend.started).toBe(1);
    // Three opens (the wrapper's, and one per command), and every one of them closed.
    expect(backend.commands.filter((command) => command === "open_gesture")).toHaveLength(3);
    expect(backend.closed).toBe(3);
  });

  it("returns what its body returned", async () => {
    installBackend();

    await expect(withGesture("rename", async () => Promise.resolve(7))).resolves.toBe(7);
  });

  it("runs the body anyway when the gesture cannot be opened", async () => {
    const backend = installBackend({ openFails: true });

    await withGesture("paste 2 nodes", async () => {
      await invoke("duplicate_task");
    });

    expect(backend.gestureOf).toEqual([null]);
    expect(backend.closed).toBe(0);
  });
});

describe("gestureName", () => {
  it("remembers the name a gesture was opened with", async () => {
    const backend = installBackend();

    await withGesture("paste 5 nodes", async () => {
      await invoke("duplicate_task");
    });

    expect(gestureName(backend.ids[0] ?? "")).toBe("paste 5 nodes");
  });

  it("keeps the outermost name when a gesture is opened inside another", async () => {
    const backend = installBackend();

    await withGesture("paste 5 nodes", async () => {
      await withGesture("move 1 node", async () => {
        await invoke("update_task");
      });
    });

    expect(gestureName(backend.ids[0] ?? "")).toBe("paste 5 nodes");
  });

  it("has no name for a gesture nobody named", async () => {
    const backend = installBackend();

    await invoke("update_task");

    expect(gestureName(backend.ids[0] ?? "")).toBeUndefined();
  });
});

describe("undo, redo and undo_status", () => {
  it("do not open a gesture of their own", async () => {
    const backend = installBackend();

    await undo();
    await redo();
    await undoStatus();

    expect(backend.commands).toEqual(["undo", "redo", "undo_status"]);
  });
});
