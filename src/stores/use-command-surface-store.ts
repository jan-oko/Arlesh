import { create } from "zustand";
import type { Chord, HotkeyGroup, HotkeyLabelKey, Section } from "@/utils/hotkeys/chord";
import type en_touch from "@/i18n/locales/en/touch.json";

/** A key of the `touch` namespace. */
export type TouchLabelKey = keyof typeof en_touch;

/** Where a command's words live: a binding's in `hotkeys`, a touch command's in `touch`. */
export type CommandLabel =
  | { namespace: "hotkeys"; key: HotkeyLabelKey }
  | { namespace: "touch"; key: TouchLabelKey };

/**
 * One thing the palette and the action bar can run, live: a binding of the hotkey registry bound
 * to the context its table was last rendered with, or a touch command a view registers beside its
 * bindings (one with no key, such as the action bar's New).
 */
export interface SurfaceCommand {
  id: string;
  /** The key that runs it, or `null` for a touch command, which has none. */
  chord: Chord | null;
  label: CommandLabel;
  section: Section | "touch";
  group: HotkeyGroup | null;
  /** An alias of another binding (the numpad zoom, `Ctrl+Y`): dispatchable, never listed. */
  hidden: boolean;
  /** Whether it would act now: its table is live and its guard passes. */
  canRun: () => boolean;
  run: () => void;
}

interface CommandSurfaceStore {
  /** Each mounted table's commands, by the token of the hook that published it. */
  tables: ReadonlyMap<string, readonly SurfaceCommand[]>;
  /**
   * Bumped whenever a publishing hook re-renders. A command's `canRun` reads its table's latest
   * context through a ref, so nothing about the command itself changes when the selection does;
   * this is what tells the action bar to ask again.
   */
  revision: number;
  publish: (token: string, commands: readonly SurfaceCommand[]) => void;
  withdraw: (token: string) => void;
  refresh: () => void;
}

/**
 * The command surface: every binding table currently mounted, with its live context, so that a
 * surface other than the keyboard — the command palette, the action bar — runs exactly what the key
 * would. `useHotkeys` publishes to it; nothing here knows a view. App-wide rather than per tab,
 * because only the active tab's views are mounted.
 */
export const useCommandSurfaceStore = create<CommandSurfaceStore>()((set) => ({
  tables: new Map(),
  revision: 0,
  publish: (token, commands) =>
    set((state) => {
      const tables = new Map(state.tables);
      tables.set(token, commands);
      return { tables, revision: state.revision + 1 };
    }),
  withdraw: (token) =>
    set((state) => {
      if (!state.tables.has(token)) return state;
      const tables = new Map(state.tables);
      tables.delete(token);
      return { tables, revision: state.revision + 1 };
    }),
  refresh: () => set((state) => ({ revision: state.revision + 1 })),
}));

/** Every published command, in the order the tables were mounted and each table lists them. */
export function allSurfaceCommands(tables: ReadonlyMap<string, readonly SurfaceCommand[]>): SurfaceCommand[] {
  return [...tables.values()].flat();
}

/** The first of `ids` that is published and can act now, or `null` when none can. */
export function firstRunnable(commands: readonly SurfaceCommand[], ids: readonly string[]): SurfaceCommand | null {
  for (const id of ids) {
    const command = commands.find((candidate) => candidate.id === id);
    if (command !== undefined && command.canRun()) return command;
  }
  return null;
}
