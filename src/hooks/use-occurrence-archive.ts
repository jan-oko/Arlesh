import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { setHabitInstanceArchived } from "@/api/flows";
import { getErrorMessage } from "@/api/errors";
import { withAtomicGesture } from "@/api/gesture";
import type { OccurrenceKey } from "@/api/flows";
import type { MindmapNode } from "@/utils/tree-layout";

interface Options {
  reload: () => Promise<void>;
  showToast: (toast: { nodeId: string; message: string }) => void;
}

/**
 * What `Delete` does to a selection holding Habit occurrences: `true` when it dealt with it, so the
 * caller's ordinary delete does not run.
 *
 * A Habit occurrence — an item's, or an iteration root — is never deleted: `Delete` **archives**
 * it by hand, the whole selection as one undo step, and a toast says where it went and how to
 * bring it back. A folded run of history among them is not a node of its own and refuses the whole
 * selection, out loud. A selection mixing virtual and real nodes is not this hook's: it returns
 * `false`, and the caller refuses it whole, since a destructive gesture never acts on half of what
 * was selected.
 */
export function useOccurrenceArchive({ reload, showToast }: Options): (nodes: MindmapNode[]) => boolean {
  const { t } = useTranslation(["warnings", "undo"]);

  return useCallback(
    (nodes: MindmapNode[]): boolean => {
      const [first] = nodes;
      if (first === undefined || !nodes.every((node) => node.virtual === true)) return false;
      const keys: OccurrenceKey[] = [];
      for (const node of nodes) {
        if (node.habitItem === undefined) {
          showToast({ nodeId: first.id, message: t("warnings:deleteRepetitionRefused") });
          return true;
        }
        keys.push(node.habitItem);
      }
      void (async () => {
        try {
          await withAtomicGesture(t("undo:gestures.archiveOccurrence", { count: keys.length }), async () => {
            for (const key of keys) await setHabitInstanceArchived(key, true);
          });
          showToast({ nodeId: first.id, message: t("warnings:occurrenceArchived", { count: keys.length }) });
        } catch (error: unknown) {
          showToast({ nodeId: first.id, message: getErrorMessage(error) });
        }
        await reload();
      })();
      return true;
    },
    [reload, showToast, t],
  );
}
