import { create } from "zustand";
import { persist } from "zustand/middleware";

/** What a fresh install does: close to the tray, so the MCP endpoint survives a reflexive close. */
export const DEFAULT_CLOSE_TO_TRAY = true;

interface CloseToTrayStore {
  /** Whether the window's close button hides Arlesh to the tray instead of quitting it. */
  closeToTray: boolean;
  setCloseToTray: (closeToTray: boolean) => void;
  toggleCloseToTray: () => void;
}

function hasCloseToTray(value: object): value is { closeToTray: unknown } {
  return Object.prototype.hasOwnProperty.call(value, "closeToTray");
}

/**
 * Backfills the stored setting, falling back to the default whenever the stored blob is not a
 * boolean under `closeToTray`.
 *
 * Worth a guard of its own, unlike a filter field: the value decides whether the close button
 * quits, and `undefined` read as falsy would silently hand someone the old quit-on-close behaviour
 * they never asked for — the one outcome this setting exists to make deliberate.
 */
export function mergeCloseToTray(persisted: unknown, current: CloseToTrayStore): CloseToTrayStore {
  if (typeof persisted !== "object" || persisted === null) return current;
  if (!hasCloseToTray(persisted)) return current;
  if (typeof persisted.closeToTray !== "boolean") return current;
  return { ...current, closeToTray: persisted.closeToTray };
}

/**
 * Whether closing the window hides Arlesh to the system tray. An app preference, persisted beside
 * the theme — the close button means the same thing in every tab and every window.
 *
 * The backend holds the copy that actually decides (`crate::tray::ClosePreference`); this store is
 * the user's choice and the thing that survives a restart, and `use-close-to-tray` pushes it across
 * whenever it changes.
 */
export const useCloseToTrayStore = create<CloseToTrayStore>()(
  persist(
    (set) => ({
      closeToTray: DEFAULT_CLOSE_TO_TRAY,
      setCloseToTray: (closeToTray) => set({ closeToTray }),
      toggleCloseToTray: () => set((s) => ({ closeToTray: !s.closeToTray })),
    }),
    { name: "arlesh-close-to-tray", merge: mergeCloseToTray },
  ),
);
