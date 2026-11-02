import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { currentReadOnlyReason } from "@/hooks/use-board-read-only";
import { usePendingWritesStore } from "@/stores/use-pending-writes-store";
import type { WriteSpec } from "@/stores/use-pending-writes-store";

/** An action as it is handed to {@link usePendingWrite}: a {@link WriteSpec} without the toast wiring. */
export type ActionWrite = Omit<WriteSpec, "showToast" | "unreachableMessage"> & {
  /** What the action does on a read-only board, with the notice it shows today. Nothing is patched. */
  refuseReadOnly: () => void;
};

interface Options {
  showToast: (toast: { nodeId: string; message: string }) => void;
}

/**
 * The hook an action uses to put a write in the window's lane (ADR 0012): it supplies the toast and
 * the unreachable notice, and keeps a read-only board out of the lane altogether.
 *
 * Returns whether the write was enqueued.
 */
export function usePendingWrite({ showToast }: Options): (write: ActionWrite) => boolean {
  const { t } = useTranslation("warnings");
  return useCallback(
    ({ refuseReadOnly, ...write }) => {
      if (currentReadOnlyReason() !== null) {
        refuseReadOnly();
        return false;
      }
      usePendingWritesStore.getState().enqueue({
        ...write,
        showToast,
        unreachableMessage: t("pendingWritesUnreachable"),
      });
      return true;
    },
    [showToast, t],
  );
}
