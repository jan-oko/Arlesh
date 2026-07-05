import type { PillMode } from "@/utils/list-filter";

const MODE_COLOR_VAR: Record<PillMode, string> = {
  any: "var(--mode-any)",
  all: "var(--mode-all)",
  exclude: "var(--mode-exclude)",
};

/** The CSS color for a pill's mode — same hue for every dimension, so a chip's mode reads at a glance. */
export function modeColorVar(mode: PillMode): string {
  return MODE_COLOR_VAR[mode];
}

/** A faded background wash from a #rrggbb aspect color (ignored for other formats, e.g. CSS var refs). */
export function tintBackground(color: string | null | undefined): string | undefined {
  return color != null && /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}22` : undefined;
}
