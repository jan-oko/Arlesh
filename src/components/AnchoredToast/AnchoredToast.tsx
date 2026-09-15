import type { PendingToast } from "@/stores/use-mindmap-store";
import type { Position } from "@/utils/tree-layout";
import { resolveToastPosition } from "@/utils/toast-position";
import StatusToast from "@/components/StatusToast/StatusToast";

interface Props {
  toast: PendingToast | null;
  positions: ReadonlyMap<string, Position>;
  onDismiss: () => void;
}

/**
 * Renders the pending anchored notice (a retype status remap, a retype failure, a
 * convert-to-flow error) at its node's laid-out position — or, when that node has no laid-out
 * position because it sits under a collapsed ancestor or outside the current `enterSubtree`
 * scope, at a fixed fallback spot. This used to render nothing in that case, silently
 * destroying the message with no fallback and no error.
 */
export default function AnchoredToast({ toast, positions, onDismiss }: Props) {
  if (toast === null) return null;
  return <StatusToast message={toast.message} position={resolveToastPosition(toast.nodeId, positions)} onDismiss={onDismiss} />;
}
