/**
 * What the Steps View has selected: one cell of the Step's grid.
 *
 * Three states, not two, because the **header card at the true root** stands for the board rather
 * than for a node. It is a cell you can select and act nothing on: there is no row behind it, so
 * `E` has nothing to open, `Space` has nothing to cycle and `Enter` has nowhere to go. Collapsing
 * that into "nothing selected" would make bare `F` fire the board-alone mode while a card is
 * visibly highlighted; collapsing it into "a node is selected" would need an id there is none of.
 */
export type StepsTarget =
  | { kind: "none" }
  | { kind: "board" }
  | { kind: "node"; id: string };

/**
 * What every Steps binding reads its target off — the one slice all the feature modules share, the
 * same arrangement the other three views' tables have.
 */
export interface StepsSelectionContext {
  target: StepsTarget;
  /**
   * Says out loud that the board's own header card is not a node.
   *
   * A gesture that cannot act has to be audible (Arlesh-zlg), and this is the one place in the
   * view where a *selected* card answers nothing — so it is the one place where silence would read
   * as a broken key rather than as an empty selection.
   */
  onRefuseBoard: () => void;
}

/** Runs `act` on the selected node, or refuses out loud when the selection is the board itself. */
export function withNode(ctx: StepsSelectionContext, act: (id: string) => void): void {
  if (ctx.target.kind === "board") { ctx.onRefuseBoard(); return; }
  if (ctx.target.kind === "node") act(ctx.target.id);
}

/** Whether any cell is selected, the board's own header card included. */
export function hasSelection(ctx: StepsSelectionContext): boolean {
  return ctx.target.kind !== "none";
}
