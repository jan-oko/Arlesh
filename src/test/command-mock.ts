import { vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

/**
 * Queues results for the command a test is actually about, with the Gesture protocol answered.
 *
 * Every `src/api/` call goes through `src/api/gesture.ts`, which opens a Gesture, invokes, and
 * closes it — three calls into Tauri where the test sees one. A bare `mockResolvedValueOnce` hands
 * its result to `open_gesture` and leaves the real command with nothing, so tests queue through
 * here instead.
 *
 * Requires the calling test file to have mocked `@tauri-apps/api/core` itself; the mock has to be
 * hoisted into that file's module graph and cannot be installed from here.
 */

/** The Gesture id every open resolves with under test. Stable, so assertions can name it. */
export const TEST_GESTURE_ID = "gesture-under-test";

/** What a Tauri plugin command answers with under test — an opaque handle nothing looks at. */
const PLUGIN_REPLY = 0;

/** Whether a command is Tauri's own plumbing rather than one of Arlesh's. */
function isPlugin(command: string): boolean {
  return command.startsWith("plugin:");
}

interface QueuedResult {
  settles: "resolve" | "reject";
  value: unknown;
}

const queue: QueuedResult[] = [];

/** Installs the queue-backed implementation and empties the queue. Call it in `beforeEach`. */
export function mockGestureProtocol(): void {
  queue.length = 0;
  vi.mocked(invoke).mockImplementation((command: string) => {
    if (command === "open_gesture") return Promise.resolve(TEST_GESTURE_ID);
    if (command === "close_gesture") return Promise.resolve(null);
    // Tauri's own plugins come through the same door. The event bus is one of them: a view that
    // listens for another window's edits subscribes on mount, and that subscription must not eat
    // the result queued for the command the test is actually about.
    if (isPlugin(command)) return Promise.resolve(PLUGIN_REPLY);
    const next = queue.shift();
    // Nothing queued means the test did not care what this command returned.
    if (next === undefined) return Promise.resolve(undefined);
    if (next.settles === "reject") return Promise.reject(next.value);
    return Promise.resolve(next.value);
  });
}

/** What the next command that is not part of the Gesture protocol resolves with. */
export function mockCommandOnce(value: unknown): void {
  queue.push({ settles: "resolve", value });
}

/** What the next command that is not part of the Gesture protocol rejects with. */
export function mockCommandFailsOnce(error: unknown): void {
  queue.push({ settles: "reject", value: error });
}

/**
 * The commands a test's subject actually issued.
 *
 * The Gesture protocol's own opens and closes are dropped, and so is Tauri's plumbing: both are
 * things every command sits inside rather than things a test is ever about.
 */
export function invokedCommands(): string[] {
  return vi
    .mocked(invoke)
    .mock.calls.map((call) => call[0])
    .filter((command) => command !== "open_gesture" && command !== "close_gesture")
    .filter((command) => !isPlugin(command));
}
