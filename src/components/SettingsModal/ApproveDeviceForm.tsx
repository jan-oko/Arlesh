import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { approveDevice, waitingDevice } from "@/api/devices";
import type { WaitingDevice } from "@/api/devices";
import { getErrorMessage } from "@/api/errors";
import styles from "./SettingsModal.module.css";
import own from "./ServerPage.module.css";

interface Props {
  /** Called once a device is approved, so the list can show it when it connects. */
  onApproved: () => void;
}

/**
 * Settings → Devices → *Approve a device*: the PIN another device is showing is typed here, the
 * name it suggested is shown and can be changed, and approving hands that device its token on its
 * next poll. The server answers the name as it saved it, suffixed if another device had it.
 */
export default function ApproveDeviceForm({ onApproved }: Props) {
  const { t } = useTranslation("server");
  const [pin, setPin] = useState("");
  const [waiting, setWaiting] = useState<WaitingDevice | null>(null);
  const [name, setName] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const pinId = useId();
  const nameId = useId();

  async function run(action: () => Promise<void>): Promise<void> {
    setIsBusy(true);
    setError(null);
    try {
      await action();
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setIsBusy(false);
    }
  }

  const lookUp = () => run(async () => {
    setSaved(null);
    const found = await waitingDevice(pin.trim());
    setWaiting(found);
    setName(found.name);
  });
  const approve = () => run(async () => {
    if (waiting === null) return;
    setSaved(await approveDevice(waiting.pin, name.trim()));
    setWaiting(null);
    setPin("");
    onApproved();
  });

  return (
    <section className={styles.page} aria-labelledby={`${pinId}-heading`}>
      <h3 id={`${pinId}-heading`} className={styles.heading}>{t("devices.approveHeading")}</h3>
      <p className={styles.note}>{t("devices.approveIntro")}</p>
      <div className={own.field}>
        <label htmlFor={pinId}>{t("devices.pin")}</label>
        <input
          id={pinId}
          className={own.input}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          value={pin}
          disabled={waiting !== null}
          onChange={(e) => { setPin(e.target.value.replace(/\D/g, "")); setSaved(null); }}
        />
      </div>
      {waiting === null ? (
        <div className={own.actions}>
          <button className={styles.button} type="button" disabled={isBusy || pin.length !== 6} onClick={() => { void lookUp(); }}>
            {isBusy ? t("devices.looking") : t("devices.lookUp")}
          </button>
        </div>
      ) : (
        <>
          <div className={own.field}>
            <label htmlFor={nameId}>{t("devices.suggestedName")}</label>
            <input id={nameId} className={own.input} type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className={own.actions}>
            <button className={styles.button} type="button" disabled={isBusy || name.trim() === ""} onClick={() => { void approve(); }}>
              {t("devices.approve")}
            </button>
          </div>
        </>
      )}
      {saved !== null && <p className={styles.note} role="status">{t("devices.approved", { name: saved })}</p>}
      {error !== null && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}
