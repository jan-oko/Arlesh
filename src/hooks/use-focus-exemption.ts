import { useState } from "react";

interface Previous {
  selectedNodeId: string | null;
  filterKeys: readonly unknown[];
}

function keysChanged(previous: readonly unknown[], current: readonly unknown[]): boolean {
  if (previous.length !== current.length) return true;
  return previous.some((key, index) => key !== current[index]);
}

/**
 * The node currently **exempt from the filter**: the one you have selected, held on screen even once
 * your own edit stops it matching, so marking a task Done under Plan no longer makes it vanish
 * mid-thought.
 *
 * The exemption is the selection, and it ends the moment the selection moves (arrow away and the node
 * goes; arrowing back does not bring it back, since it is no longer on screen to arrow to), the moment
 * it is cleared with Escape, and the moment any `filterKeys` value changes — a filter toggle is an
 * answer to "what should I be seeing", so it is honoured immediately rather than held open by whatever
 * happened to be selected. Nothing is persisted, so a reload ends it too.
 *
 * `filterKeys` are the filter and frame values whose change ends the exemption, compared by identity
 * like a hook dependency list (the shared filter, a view's own filters, the subtree you are inside).
 */
export function useFocusExemption(selectedNodeId: string | null, filterKeys: readonly unknown[]): string | null {
  const [exemptNodeId, setExemptNodeId] = useState<string | null>(selectedNodeId);
  const [previous, setPrevious] = useState<Previous>({ selectedNodeId, filterKeys });

  const selectionMoved = previous.selectedNodeId !== selectedNodeId;
  const filterChanged = keysChanged(previous.filterKeys, filterKeys);
  const current = selectionMoved ? selectedNodeId : filterChanged ? null : exemptNodeId;

  // The getDerivedStateFromProps pattern the Mindmap node already uses: setting state during render
  // is safe when guarded by a changed-value check — React re-renders once rather than looping.
  if (selectionMoved || filterChanged) {
    setPrevious({ selectedNodeId, filterKeys });
    setExemptNodeId(current);
  }

  return current;
}
