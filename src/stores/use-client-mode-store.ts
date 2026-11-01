import { create } from "zustand";
import type { ModeStatus, ServerStatus } from "@/api/client-mode";

/**
 * This window's copy of the mode and the server's status (see `src/api/client-mode.ts`). Not
 * persisted: the backend holds both. `null` until the first read lands, which every reader treats
 * as Standalone, so a window that never hears shows what it always did.
 */
interface ClientModeStore {
  status: ModeStatus | null;
  /** Records the mode as the backend answered it. */
  receive: (status: ModeStatus) => void;
  /** Records the server's new status, as the backend announced it. */
  receiveServer: (server: ServerStatus) => void;
  /** Records that the first-run question was answered. */
  answered: () => void;
}

export const useClientModeStore = create<ClientModeStore>()((set) => ({
  status: null,
  receive: (status) => set({ status }),
  receiveServer: (server) => set((state) => (
    state.status === null ? state : { status: { ...state.status, server } }
  )),
  answered: () => set((state) => (
    state.status === null ? state : { status: { ...state.status, first_run: false } }
  )),
}));

/** Whether this device runs as a client of a server. */
export function isClientMode(status: ModeStatus | null): boolean {
  return status?.mode === "client";
}
