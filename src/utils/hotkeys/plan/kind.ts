import type { Binding } from "@/utils/hotkeys/chord";
import type { HotkeyLabelKey } from "@/utils/hotkeys/chord";
import type { ViewKind } from "@/utils/scope-calendar";
import type { PlanSelectionContext } from "./selection";

/** What switching the kind of scope being filled acts on. */
export interface PlanKindContext extends PlanSelectionContext {
  /** Fills the given kind, exactly as picking it in the kind selector does. */
  onSetScopeKind: (kind: ViewKind) => void;
}

/** The letter that fills each kind, and its cheat-sheet line. Exact has none: it is never filled. */
export const SCOPE_KIND_KEYS: ReadonlyArray<{ kind: ViewKind; letter: string; labelKey: HotkeyLabelKey }> = [
  { kind: "season", letter: "S", labelKey: "planKindSeason" },
  { kind: "month", letter: "M", labelKey: "planKindMonth" },
  { kind: "week", letter: "W", labelKey: "planKindWeek" },
  { kind: "day", letter: "D", labelKey: "planKindDay" },
  { kind: "part_of_day", letter: "P", labelKey: "planKindPartOfDay" },
];

/**
 * A single letter switches the kind of scope being filled — **only with nothing selected**.
 *
 * All five letters are already a subscope mnemonic: with the planned pane split, `M` plans the
 * selection into Monday, `S` into a month starting with S, `P` into Premorning, and so on (see
 * `subscope.ts`). That binding needs a selection and this one refuses one, so the two guards are
 * complementary and a letter has exactly one meaning in any state. The selection is the tiebreak
 * because it is what the subscope letter acts on: with rows selected, a letter is about those rows.
 *
 * Refusing a selection even where no bucket answers to the letter (the split off, say) is
 * deliberate. "M switches to months" would otherwise hold or not depending on whether the pane on
 * the right happened to be split, which is not something anyone keeps in their head mid-pass.
 */
export const PLAN_KIND_BINDINGS: readonly Binding<PlanKindContext>[] = SCOPE_KIND_KEYS.map(({ kind, letter, labelKey }) => ({
  id: `planView.kind.${kind}`,
  section: "planView",
  chord: { code: `Key${letter}` },
  labelKey,
  allowRepeat: false,
  when: (c) => c.selectedTaskIds.length === 0,
  run: (c) => c.onSetScopeKind(kind),
}));
