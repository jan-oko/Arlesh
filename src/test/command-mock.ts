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

/** The commands a test's subject actually issued, with the protocol's own opens and closes dropped. */
export function invokedCommands(): string[] {
  return vi
    .mocked(invoke)
    .mock.calls.map((call) => call[0])
    .filter((command) => command !== "open_gesture" && command !== "close_gesture");
}
