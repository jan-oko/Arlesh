import { create } from "zustand";

/** The Settings modal's pages, in the order its sidebar lists them. */
export type SettingsPage =
  | "general" | "mindmap" | "list" | "steps" | "plan" | "zen" | "windows" | "expectations" | "mcp"
  | "server" | "devices";

/**
 * Whether the Settings modal is open, on which page, and the element it should scroll to.
 *
 * Shared so that something other than the gear can open Settings where it matters — the agents'
 * status menu opens it on the Agents section. `anchor` is a DOM id inside the page; it is a
 * request, consumed by the page once it has drawn, and cleared when the modal closes.
 */
interface SettingsStore {
  isOpen: boolean;
  page: SettingsPage;
  anchor: string | null;
  /** Opens Settings on `page` (General by default), scrolled to `anchor` when given. */
  show: (page?: SettingsPage, anchor?: string) => void;
  /** Closes Settings. */
  hide: () => void;
}

export const useSettingsStore = create<SettingsStore>()((set) => ({
  isOpen: false,
  page: "general",
  anchor: null,
  show: (page = "general", anchor) => set({ isOpen: true, page, anchor: anchor ?? null }),
  hide: () => set({ isOpen: false, anchor: null }),
}));
