/**
 * Which window this webview is, by name.
 *
 * Deliberately a module of its own, with **no Tauri import at all**. The tab store reads the label
 * at module scope — a webview belongs to one window for its whole life, so there is nothing to wait
 * for — and the store is imported by the test setup. Anything the store can reach is therefore
 * loaded before a suite's own `vi.mock` has run, and a module that reached `@tauri-apps/api/core`
 * from here would hand every `src/api/` file the real `invoke` while the test asserted on the mock.
 *
 * So the label is read straight off the object the Tauri host writes onto the page before the app
 * boots, rather than through `getCurrentWindow()`, which would drag the whole client in behind it.
 */

/** The label of the window Arlesh opens on a first run. */
export const BOOTSTRAP_WINDOW_LABEL = "main";

/** What the Tauri host writes onto the page. Everything about it is unknown until it is checked. */
const HOST_GLOBAL = "__TAURI_INTERNALS__";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The label the host announced, or `null` when there is no host to have announced one. */
function hostWindowLabel(): string | null {
  const internals: unknown = Reflect.get(globalThis, HOST_GLOBAL);
  if (!isRecord(internals)) return null;
  const metadata = internals["metadata"];
  if (!isRecord(metadata)) return null;
  const current = metadata["currentWindow"];
  if (!isRecord(current)) return null;
  const label = current["label"];
  return typeof label === "string" && label !== "" ? label : null;
}

/**
 * This webview's window label, which is also the key its tabs are stored under.
 *
 * With no host to ask — a unit test's jsdom — it is the bootstrap label, because under test there
 * is exactly one window and it is the first.
 */
export function currentWindowLabel(): string {
  return hostWindowLabel() ?? BOOTSTRAP_WINDOW_LABEL;
}

/**
 * A label for a window that does not exist yet.
 *
 * Minted on this side because the new window's tabs are written to storage under it before the
 * window is asked for. The prefix is for a reader of the stored keys and of a log line; nothing
 * parses it.
 */
export function newWindowLabel(): string {
  return `board-${crypto.randomUUID()}`;
}
