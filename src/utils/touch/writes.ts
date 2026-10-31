/**
 * Which commands write to the board — what a read-only board (Client mode, the server unreachable
 * or on another API version; docs/spec/client-mode.md) greys out on the touch surfaces. Listed the
 * other way round, by what only reads: moving the selection or the view, the presets and filters,
 * zoom, folding, the tab and app chords, opening an editor or a search, copying. Anything not
 * listed is taken to write, so a new binding is greyed out until someone says it only reads.
 */
const READS_ONLY: readonly RegExp[] = [
  /^(global|tabs)\./,
  /\.(status|preset|navigate|navigateShift|pan|panShift|extendSelection|kind)\./,
  new RegExp(`\\.(${[
    "navigateUp", "navigateDown", "jumpToFirst", "jumpToLast", "scrollUp", "scrollDown", "deselect",
    "focusRoot", "centerOnNode", "zoomIn", "zoomOut", "zoomInNumpad", "zoomOutNumpad",
    "toggleCollapsed", "toggleSubtreeCollapsed", "toggleFullscreen", "openEditor", "copy",
    "focusCandidates", "focusPlanned", "previousScope", "nextScope", "upScope", "toggleBacklogCandidates",
    "extendUp", "extendDown", "descend", "pageNext", "pagePrevious", "pageNextBracket", "pagePreviousBracket",
  ].join("|")})$`),
];

/** Whether the command `id` writes to the board. */
export function isWriteCommand(id: string): boolean {
  return !READS_ONLY.some((pattern) => pattern.test(id));
}
