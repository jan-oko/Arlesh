import { useTranslation } from "react-i18next";
import { usePushSettings } from "@/hooks/use-push-settings";
import { useClientModeStore } from "@/stores/use-client-mode-store";
import { isAndroid } from "@/utils/platform";
import styles from "./SettingsModal.module.css";

/** The channels, in the order Android lists them. Ids match the server's. */
const CHANNELS = ["agent_question", "task_overdue", "task_generated", "capacity_locked", "capacity_cleared"] as const;

/**
 * Settings → Notifications: which events the phone is told of, and whether it can be. Each event is
 * an Android notification channel, switched in the system's own settings, so this page says what
 * they are, asks for the permission and links there. Client mode on Android only.
 */
export default function NotificationsPage() {
  const { t } = useTranslation("server");
  const mode = useClientModeStore((s) => s.status?.mode);
  if (mode !== "client" || !isAndroid()) {
    return <div className={styles.page}><p className={styles.note}>{t("notifications.notAvailable")}</p></div>;
  }
  return <PhoneNotifications />;
}

function PhoneNotifications() {
  const { t } = useTranslation("server");
  const { status, error, requestPermission, openSystemSettings } = usePushSettings();

  return (
    <div className={styles.page}>
      <p className={styles.note}>{t("notifications.intro")}</p>
      {error !== null && <p role="alert" className={styles.note}>{error}</p>}
      {status === "loading" && <p className={styles.note}>{t("notifications.loading")}</p>}
      {status === "unsupported" && <p className={styles.note}>{t("notifications.unsupported")}</p>}
      {status === "serverOff" && <p className={styles.note}>{t("notifications.serverOff")}</p>}
      {status === "blocked" && (
        <>
          <p className={styles.note}>{t("notifications.blocked")}</p>
          <button className={styles.button} type="button" onClick={requestPermission}>
            {t("notifications.allow")}
          </button>
        </>
      )}
      {status === "ready" && (
        <>
          <ul>
            {CHANNELS.map((channel) => <li key={channel}>{t(`notifications.channel.${channel}`)}</li>)}
          </ul>
          <p className={styles.note}>{t("notifications.switches")}</p>
        </>
      )}
      {(status === "ready" || status === "blocked") && (
        <button className={styles.button} type="button" onClick={openSystemSettings}>
          {t("notifications.openSettings")}
        </button>
      )}
    </div>
  );
}
