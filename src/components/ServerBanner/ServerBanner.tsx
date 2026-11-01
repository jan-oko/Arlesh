import { useTranslation } from "react-i18next";
import { useClientModeStore } from "@/stores/use-client-mode-store";
import styles from "./ServerBanner.module.css";

/** A local date-time from the backend (`YYYY-MM-DDTHH:MM:SS…`) as this locale writes one. */
export function formatSync(lastSync: string): string {
  const at = new Date(lastSync);
  return Number.isNaN(at.getTime()) ? lastSync : at.toLocaleString();
}

/**
 * Says why the board is read-only in Client mode: the server cannot be reached (with when it was
 * last synced), or it speaks another API version (naming the side to update). Shows nothing
 * Standalone, or while the server can be written to.
 */
export default function ServerBanner() {
  const { t } = useTranslation("server");
  const server = useClientModeStore((s) => s.status?.server ?? null);
  if (server === null || server.read_only === null) return null;
  const reason = server.read_only;
  return (
    <div className={styles.banner} role="status">
      <span>{t(`banner.${reason}`)}</span>
      {reason === "server_unreachable" && (
        <span className={styles.sync}>
          {server.last_sync === null
            ? t("banner.neverSynced")
            : t("banner.lastSync", { time: formatSync(server.last_sync) })}
        </span>
      )}
    </div>
  );
}
