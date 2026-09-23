import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { setHabitInstanceDeleted } from "@/api/flows";
import { getErrorMessage } from "@/api/errors";
import { withGesture } from "@/api/gesture";
import { editableOccurrence } from "@/hooks/use-occurrence-editor";
import type { MindmapNode } from "@/utils/tree-layout";

interface Options {
  reload: () => Promise<void>;
  showToast: (toast: { nodeId: string; message: string }) => void;
}

/**
 * What `Delete` does to a selection holding Habit occurrences: `true` when it dealt with it, so
 * the caller's ordinary delete does not run.
 *
 * A selection made only of item occurrences deletes each from its iteration alone — a tombstone,
 * one undo step for the lot, and a toast that says where they went and how to bring them back. An
 * iteration root among them refuses the whole selection, out loud. A selection mixing virtual and
 * real nodes is not this hook's: it returns `false`, and the caller refuses it whole, since a
 * destructive gesture never acts on half of what was selected.
 */
export function useOccurrenceDelete({ reload, showToast }: Options): (nodes: MindmapNode[]) => boolean {
  const { t } = useTranslation(["warnings", "undo"]);

  return useCallback(
    (nodes: MindmapNode[]): boolean => {
      const [first] = nodes;
      if (first === undefined || !nodes.every((node) => node.virtual === true)) return false;
      const keys = nodes.map(editableOccurrence);
      if (keys.some((key) => key === null)) {
        showToast({ nodeId: first.id, message: t("warnings:deleteRepetitionRefused") });
        return true;
      }
      void (async () => {
        try {
          await withGesture(t("undo:gestures.deleteOccurrence", { count: nodes.length }), async () => {
            for (const key of keys) if (key !== null) await setHabitInstanceDeleted(key, true);
          });
          showToast({ nodeId: first.id, message: t("warnings:occurrenceDeleted", { count: nodes.length }) });
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
