import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { listenReplicaDropped } from "@/api/replica";
import { activeTabStores } from "@/hooks/use-system-back";

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
    void listenReplicaDropped(({ count, reason }) => {
      const message = reason === "refused" ? t("replicaRefused", { count }) : t("replicaUnreachable", { count });
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
