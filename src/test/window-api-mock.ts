import { vi } from "vitest";

/**
 * A stand-in for `src/api/window.ts`, for the suites that assert on what closing a tab does.
 *
 * The real module reaches Tauri for everything: the label of the window it is running in, the list
 * of the others, and the commands that open and focus them. jsdom has none of that. Mocking the
 * module wholesale is the established shape here — what changes with windows is that the module now
 * has more than one export, and a mock that provides only `closeWindow` leaves the tab store with
 * no window to key its storage by.
 *
 * Under test there is exactly one window and it is the first, which is what the labels here say.
 *
 * Used as `vi.mock("@/api/window", async () => (await import("@/test/window-api-mock")).windowApi())`
 * — the dynamic import is what lets a hoisted factory reach a module at all.
 */
export function windowApi() {
  let minted = 0;
  return {
    BOOTSTRAP_WINDOW_LABEL: "main",
    currentWindowLabel: (): string => "main",
    newWindowLabel: (): string => `board-${(minted += 1)}`,
    closeWindow: vi.fn(() => Promise.resolve()),
    openBoardWindow: vi.fn(() => Promise.resolve()),
    boardWindowLabels: vi.fn(() => Promise.resolve(["main"])),
    focusBoardWindow: vi.fn(() => Promise.resolve()),
  };
}
