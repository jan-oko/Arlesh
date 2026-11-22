import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { listenReplicaDropped } from "@/api/replica";
import type { ReplicaDropReason } from "@/api/replica";
import { activeTabStores } from "@/hooks/use-system-back";

/** The notice for one `replica-dropped` event. */
function replicaMessage(t: TFunction<"warnings">, { count, saved, reason }: { count: number; saved: number; reason: ReplicaDropReason }): string {
  if (reason === "refused") return t("replicaRefused", { count });
  if (reason === "differed") return t("replicaDiffered", { count });
  if (reason === "suspended") return t("replicaSuspended", { count });
  if (saved === 0) return t("replicaUnreachable", { count });
  if (count === 0) return t("replicaMaybeSaved", { count: saved });
  return t("replicaUnreachableMaybeSaved", { count, saved });
}

/**
 * Says so, once per event, when the Replica takes changes back: the server refused them, or could
 * not be reached to be sent them. The board has already been put right by then; the toast is how
 * the user learns that something they did is gone. Mounted once, at the app root.
 */
export function useReplicaToasts(): void {
  const { t } = useTranslation("warnings");
  useEffect(() => {
    let subscribed = true;
    let unlisten: (() => void) | null = null;
    void listenReplicaDropped(({ count, maybe_saved: saved, reason }) => {
      const message = replicaMessage(t, { count, saved, reason });
      activeTabStores()?.mindmap.getState().showToast({ nodeId: "", message });
    }).then((stop) => {
      if (subscribed) unlisten = stop;
      else stop();
    });
    return () => {
      subscribed = false;
      unlisten?.();
    };
  }, [t]);
}
