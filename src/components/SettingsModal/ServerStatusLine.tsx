import { useTranslation } from "react-i18next";
import { formatSync } from "@/components/ServerBanner/ServerBanner";
import { useClientModeStore } from "@/stores/use-client-mode-store";
import styles from "./ServerPage.module.css";

/**
 * Settings → Server's status line: the mode, and in Client mode the server's URL, whether it
 * answers, when the board was last synced and whether its version suits this app. It is where
 * the phone looks for what the desktop's top bar shows as the mode indicator.
 */
export default function ServerStatusLine() {
  const { t } = useTranslation("server");
  const status = useClientModeStore((s) => s.status);
  if (status === null) return null;
  const server = status.server;
  if (status.mode !== "client" || server === null) {
    return <p className={styles.status} role="status">{t("status.standalone")}</p>;
  }
  const version =
    server.read_only === "update_app" || server.read_only === "update_server"
      ? t(`banner.${server.read_only}`)
      : t("status.versionOk", { server: server.server_api_version ?? "?", app: status.api_version });
  return (
    <ul className={styles.status} role="status" aria-label={t("status.label")}>
      <li>{t("status.mode", { mode: t("mode.client") })}</li>
      <li>{t("status.url", { url: server.url })}</li>
      <li>
        <span className={server.reachable ? styles.up : styles.down} aria-hidden="true" />
        {server.reachable ? t("status.reachable") : t("status.unreachable")}
      </li>
      <li>
        {server.last_sync === null
          ? t("banner.neverSynced")
          : t("banner.lastSync", { time: formatSync(server.last_sync) })}
      </li>
      <li>{version}</li>
    </ul>
  );
}
