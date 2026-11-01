import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { currentReadOnlyReason } from "@/hooks/use-board-read-only";

/**
 * The notice a write shows on a read-only board (offline, or a version mismatch): the reason the
 * board gives for being read-only, which is what the refused write said before it was held back
 * ahead of the lane (ADR 0012, decision 7). Read when it is shown, not when the hook renders.
 */
export function useReadOnlyNotice(): () => string {
  const { t } = useTranslation("server");
  return useCallback(() => t(`banner.${currentReadOnlyReason() ?? "server_unreachable"}`), [t]);
}
