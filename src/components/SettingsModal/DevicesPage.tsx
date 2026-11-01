import { useState } from "react";
import { useTranslation } from "react-i18next";
import { revokeDevice } from "@/api/devices";
import type { Device } from "@/api/devices";
import { getErrorMessage } from "@/api/errors";
import { useDevices } from "@/hooks/use-devices";
import { useClientModeStore } from "@/stores/use-client-mode-store";
import ApproveDeviceForm from "./ApproveDeviceForm";
import styles from "./SettingsModal.module.css";
import own from "./DevicesPage.module.css";

/**
 * Settings → Devices: the server's devices with when each was last seen, a form to approve a
 * device that is showing a PIN, and a revoke (after a confirmation) for every device but this
 * one — the server refuses that too, so a device cannot sign itself out. Client mode only.
 */
export default function DevicesPage() {
  const { t } = useTranslation("server");
  const mode = useClientModeStore((s) => s.status?.mode);
  if (mode !== "client") {
    return <div className={styles.page}><p className={styles.note}>{t("devices.notClient")}</p></div>;
  }
  return <ClientDevices />;
}

function ClientDevices() {
  const { t } = useTranslation("server");
  const { devices, error, isLoading, reload } = useDevices();
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  async function revoke(device: Device): Promise<void> {
    setRevokeError(null);
    try {
      await revokeDevice(device.name);
      setRevoking(null);
      await reload();
    } catch (err: unknown) {
      setRevokeError(getErrorMessage(err));
    }
  }

  return (
    <div className={styles.page}>
      <p className={styles.note}>{t("devices.intro")}</p>
      <ApproveDeviceForm onApproved={() => { void reload(); }} />
      <h3 className={styles.heading}>{t("devices.listHeading")}</h3>
      {isLoading && <p className={styles.note}>{t("devices.loading")}</p>}
      {error !== null && <p className={styles.error} role="alert">{error}</p>}
      {!isLoading && error === null && devices.length === 0 && <p className={styles.note}>{t("devices.none")}</p>}
      <ul className={own.devices} aria-label={t("devices.listHeading")}>
        {devices.map((device) => (
          <li key={device.name} className={own.device}>
            <div className={own.text}>
              <span className={own.name}>
                {device.name}
                {device.current && <span className={own.badge}>{t("devices.thisDevice")}</span>}
              </span>
              <span className={own.seen}>
                {device.last_seen_at === null
                  ? t("devices.neverSeen")
                  : t("devices.lastSeen", { time: new Date(device.last_seen_at).toLocaleString() })}
              </span>
            </div>
            {!device.current && revoking !== device.name && (
              <button
                className={styles.button}
                type="button"
                aria-label={t("devices.revoke", { name: device.name })}
                onClick={() => { setRevoking(device.name); setRevokeError(null); }}
              >
                {t("devices.revokeConfirm")}
              </button>
            )}
            {revoking === device.name && (
              <div className={own.confirm} role="group" aria-label={t("devices.revokeAsk", { name: device.name })}>
                <span>{t("devices.revokeAsk", { name: device.name })}</span>
                <button className={styles.button} type="button" onClick={() => { void revoke(device); }}>
                  {t("devices.revokeConfirm")}
                </button>
                <button className={styles.button} type="button" onClick={() => setRevoking(null)}>
                  {t("devices.revokeCancel")}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {revokeError !== null && <p className={styles.error} role="alert">{revokeError}</p>}
    </div>
  );
}
