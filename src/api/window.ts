import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Closes the window this app is running in.
 *
 * Reached only by closing the last tab: a window with no tabs is not a state the app has, so the
 * gesture that would produce one closes the window instead — the browser behaviour the tab
 * shortcuts are copied from.
 */
export async function closeWindow(): Promise<void> {
  await getCurrentWindow().close();
}
