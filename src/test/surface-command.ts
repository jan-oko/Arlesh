import { vi } from "vitest";
import type { SurfaceCommand } from "@/stores/use-command-surface-store";
import type { HotkeyLabelKey, Section } from "@/utils/hotkeys/chord";

/** A command as the surface would hold it, runnable unless the test says otherwise. */
export function surfaceCommand(id: string, labelKey: HotkeyLabelKey, overrides: Partial<SurfaceCommand> = {}): SurfaceCommand {
  const section = id.split(".")[0];
  return {
    id,
    chord: { code: "KeyA" },
    label: { namespace: "hotkeys", key: labelKey },
    section: isSection(section) ? section : "global",
    group: null,
    hidden: false,
    canRun: () => true,
    run: vi.fn(),
    ...overrides,
  };
}

const SECTIONS: readonly Section[] = ["global", "tabs", "mindmap", "listView", "planView", "stepsView", "zenView"];

function isSection(value: string | undefined): value is Section {
  return SECTIONS.some((section) => section === value);
}
