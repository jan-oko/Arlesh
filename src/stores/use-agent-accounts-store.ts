import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AgentAccountsStore {
  /** Whether Settings → Agents shows the Accounts list. Closed until the user opens it. */
  open: boolean;
  toggle: () => void;
}

/** The Accounts list's last state, kept across restarts and shared by every window. */
export const useAgentAccountsStore = create<AgentAccountsStore>()(
  persist(
    (set) => ({
      open: false,
      toggle: () => set((state) => ({ open: !state.open })),
    }),
    { name: "arlesh-agent-accounts-open" },
  ),
);
