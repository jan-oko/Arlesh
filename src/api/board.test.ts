import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersistedTab } from "@/stores/tab-persistence";
import { freshTabState } from "@/stores/tab-persistence";

/**
 * A stand-in for Tauri's event bus that keeps its one rule that matters here: a listener
 * registered with **no target** hears every emit, whatever it was addressed to, and a listener
 * registered with a target hears only emits addressed to that target (`match_any_or_filter` in
 * tauri's `event/listener.rs`).
 */
interface Registration {
  event: string;
  target: string | null;
  handler: (event: { payload: unknown }) => void;
}
const bus: Registration[] = [];

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((event: string, handler: Registration["handler"], options?: { target?: string }) => {
    bus.push({ event, target: options?.target ?? null, handler });
    return Promise.resolve(() => {});
  }),
  emitTo: vi.fn((target: string, event: string, payload: unknown) => {
    for (const listener of bus) {
      if (listener.event !== event) continue;
      if (listener.target !== null && listener.target !== target) continue;
      listener.handler({ payload });
    }
    return Promise.resolve();
  }),
}));

const { claimTab, onBoardChanged, onTabClaimed, onTabMoved, sendTabToWindow } = await import("./board");

const HOST_GLOBAL = "__TAURI_INTERNALS__";

/** Runs `register` as the window labelled `label` would, so it listens under that label. */
async function asWindow(label: string, register: () => Promise<unknown>): Promise<void> {
  Reflect.set(globalThis, HOST_GLOBAL, { metadata: { currentWindow: { label } } });
  try {
    await register();
  } finally {
    Reflect.deleteProperty(globalThis, HOST_GLOBAL);
  }
}

afterEach(() => {
  bus.length = 0;
});

const TAB: PersistedTab = { id: "tab-1", title: "Architecture", customTitle: null, state: freshTabState() };

describe("addressing a tab to one window, with three open", () => {
  it("is adopted only by the window it was sent to — not by the others, and not by its sender", async () => {
    // Windows A and B, and C: a window torn off from B, whose only tab this is.
    const adopted: Record<string, string[]> = { A: [], B: [], C: [] };
    for (const label of ["A", "B", "C"]) {
      await asWindow(label, () => onTabMoved((tab) => adopted[label]?.push(tab.id)));
    }

    // C hands its last tab to A, the window it was dropped on.
    await sendTabToWindow("A", TAB);

    expect(adopted).toEqual({ A: ["tab-1"], B: [], C: [] });
  });

  it("delivers a claim only to the window that holds the tab", async () => {
    const heard: Record<string, number> = { A: 0, B: 0, C: 0 };
    for (const label of ["A", "B", "C"]) {
      await asWindow(label, () => onTabClaimed(() => { heard[label] = (heard[label] ?? 0) + 1; }));
    }

    await claimTab("C", { tabId: "tab-1", into: "A" });

    expect(heard).toEqual({ A: 0, B: 0, C: 1 });
  });

  it("tells a window the board changed once per announcement addressed to it", async () => {
    const reloads: Record<string, number> = { A: 0, B: 0, C: 0 };
    for (const label of ["A", "B", "C"]) {
      await asWindow(label, () => onBoardChanged(() => { reloads[label] = (reloads[label] ?? 0) + 1; }));
    }
    const { emitTo } = await import("@tauri-apps/api/event");

    // The backend announces a change made in A once to each other window.
    await emitTo("B", "board-changed", null);
    await emitTo("C", "board-changed", null);

    expect(reloads).toEqual({ A: 0, B: 1, C: 1 });
  });
});
