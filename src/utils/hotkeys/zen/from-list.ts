import type { Binding, HotkeyLabelKey } from "@/utils/hotkeys/chord";

const LIST_PREFIX = "listView.";

/**
 * A List View binding table, as the Zen View's: the same chords, guards and actions, filed under the
 * Zen section of the cheat-sheet with a `zenView.` id. `labels` rewords a row where the list's words
 * name a row and the Zen View's thing is a card.
 *
 * This is how the Zen View takes the List View's keys **without copying them**: a binding's meaning
 * lives once, in its `list/` module, so the two views cannot drift apart on what `B` or `Enter` does.
 */
export function asZenBindings<Ctx>(
  bindings: readonly Binding<Ctx>[],
  labels: Readonly<Record<string, HotkeyLabelKey>> = {},
): Binding<Ctx>[] {
  return bindings.map((binding) => ({
    ...binding,
    id: binding.id.startsWith(LIST_PREFIX) ? `zenView.${binding.id.slice(LIST_PREFIX.length)}` : binding.id,
    section: "zenView",
    labelKey: labels[binding.id] ?? binding.labelKey,
  }));
}
