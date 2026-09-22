import { invoke } from "./gesture";

/**
 * Tells the backend whether the window's close button hides Arlesh to the tray or quits it.
 *
 * The backend starts on the same default the stored setting has, so a frontend that never gets
 * around to calling this leaves the close button meaning what the user last chose on a fresh
 * install rather than something arbitrary.
 */
export async function setCloseToTray(enabled: boolean): Promise<void> {
  await invoke<null>("set_close_to_tray", { enabled });
}

/**
 * Quits Arlesh, releasing the database and the MCP endpoint.
 *
 * It does not resolve: the process is gone before the reply could come back. Callers must not wait
 * on it for anything.
 */
export async function quitApp(): Promise<void> {
  await invoke<null>("quit_app");
}
