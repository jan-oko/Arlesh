import { useTranslation } from "react-i18next";
import { useClientModeStore } from "@/stores/use-client-mode-store";
import styles from "./ModeIndicator.module.css";

/**
 * The top bar's mode: *This device* Standalone; in Client mode, *Server* with a dot that says
 * whether the server is reachable, and the URL on hover. Nothing until the mode has been read.
 */
export default function ModeIndicator() {
  const { t } = useTranslation("server");
  const status = useClientModeStore((s) => s.status);
  if (status === null) return null;
  const server = status.server;
  if (status.mode !== "client" || server === null) {
    return <span className={styles.mode}>{t("mode.standalone")}</span>;
  }
  const label = server.reachable
    ? t("mode.reachable", { url: server.url })
    : t("mode.unreachable", { url: server.url });
  return (
    <span className={styles.mode} title={label} aria-label={label} role="status">
      <span className={server.reachable ? styles.up : styles.down} aria-hidden="true" />
      {t("mode.client")}
    </span>
  );
}
