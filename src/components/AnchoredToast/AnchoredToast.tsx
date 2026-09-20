import type { PendingToast } from "@/stores/use-mindmap-store";
import StatusToast from "@/components/StatusToast/StatusToast";

interface Props {
  toast: PendingToast | null;
  onDismiss: () => void;
}

/**
 * Renders the pending notice (a retype status remap, a retype failure, a refused typed-child
 * chord, a convert-to-flow error), or nothing when there is none.
 *
 * It no longer consults the anchor node's laid-out position. Two bugs lived in that lookup: a
 * node with no position — under a collapsed ancestor, or outside the current `enterSubtree`
 * scope — used to render nothing and destroy the message, and a node *with* one supplied a d3
 * layout coordinate to CSS that reads it as a container offset, which pushed the toast off the
 * left edge. Both are now structurally impossible rather than guarded: `StatusToast` places
 * itself in the viewport, so there is no position to be missing or wrong.
 */
export default function AnchoredToast({ toast, onDismiss }: Props) {
  if (toast === null) return null;
  return <StatusToast message={toast.message} onDismiss={onDismiss} />;
}
