import { vi } from "vitest";

/**
 * A stand-in for `src/api/window.ts`, for the suites that assert on what closing a tab does.
 *
 * Every export of that module reaches Tauri — closing this window, opening another, listing them,
 * focusing one — and jsdom has none of that. Mocking the module wholesale is the established shape
 * here; what changes with windows is that it now has four exports rather than one, and a mock that
 * provides only `closeWindow` leaves a hook calling `undefined()`.
 *
 * Labels are **not** here: `@/api/window-label` reaches nothing and works as it is, answering with
 * the bootstrap label, which is the truth under test — there is one window and it is the first.
 *
 * Used as `vi.mock("@/api/window", async () => (await import("@/test/window-api-mock")).windowApi())`
 * — the dynamic import is what lets a hoisted factory reach a module at all.
 */
export function windowApi() {
  return {
    closeWindow: vi.fn(() => Promise.resolve()),
    openBoardWindow: vi.fn(() => Promise.resolve()),
    boardWindowLabels: vi.fn(() => Promise.resolve(["main"])),
    focusBoardWindow: vi.fn(() => Promise.resolve()),
    setWindowTitle: vi.fn(() => Promise.resolve()),
    // jsdom has no desktop, so nothing is under the pointer. A drag in a test is a reorder.
    windowAtCursor: vi.fn(() => Promise.resolve(null)),
  };
}
