import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { connectToServer, keychainAvailable, testServer, runStandalone } from "@/api/client-mode";
import { deviceName } from "@/api/devices";
import type { ServerCheck } from "@/api/client-mode";
import { getErrorMessage } from "@/api/errors";
import { usePairing } from "@/hooks/use-pairing";
import { useClientModeStore } from "@/stores/use-client-mode-store";
import ServerStatusLine from "./ServerStatusLine";
import styles from "./SettingsModal.module.css";
import own from "./ServerPage.module.css";

/**
 * Settings → Server: where this device's board lives. A server URL and a token, tested against
 * the server's `/health` and API version before switching; switching saves the choice and restarts
 * the app. Switching back to this device keeps nothing from the server, and finds the local board
 * as it was left.
 */
export default function ServerPage() {
  const { t } = useTranslation("server");
  const status = useClientModeStore((s) => s.status);
  const [url, setUrl] = useState(status?.server?.url ?? "");
  const [token, setToken] = useState("");
  const [check, setCheck] = useState<ServerCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [keychain, setKeychain] = useState(true);
  const [tokenInFile, setTokenInFile] = useState(false);
  const [name, setName] = useState("");
  const urlId = useId();
  const nameId = useId();
  const tokenId = useId();

  useEffect(() => {
    deviceName().then(setName).catch(() => setName(""));
  }, []);

  useEffect(() => {
    keychainAvailable().then(setKeychain).catch(() => setKeychain(false));
  }, []);

  const pairing = usePairing((newToken, serverUrl) => connectToServer(serverUrl, newToken, !keychain && tokenInFile));
  const isClient = status?.mode === "client";
  const canPair = url.trim() !== "" && (keychain || tokenInFile);
  const isPairing = pairing.state.phase === "starting" || pairing.state.phase === "waiting";
  const ready = url.trim() !== "" && token.trim() !== "" && (keychain || tokenInFile);

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

  const test = () => run(async () => {
    setCheck(null);
    setCheck(await testServer(url.trim(), token.trim()));
  });
  const connect = () => run(() => connectToServer(url.trim(), token.trim(), !keychain && tokenInFile));
  const standalone = () => run(() => runStandalone());

  return (
    <div className={styles.page}>
      <p className={styles.note}>{t("page.intro")}</p>
      <ServerStatusLine />
      <div className={own.field}>
        <label htmlFor={urlId}>{t("page.url")}</label>
        <input
          id={urlId}
          className={own.input}
          type="url"
          value={url}
          placeholder="https://"
          onChange={(e) => { setUrl(e.target.value); setCheck(null); }}
        />
      </div>
      <div className={own.field}>
        <label htmlFor={nameId}>{t("pair.name")}</label>
        <input
          id={nameId}
          className={own.input}
          type="text"
          value={name}
          disabled={isPairing}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      {pairing.state.phase === "waiting" ? (
        <div className={own.pairing} role="status">
          <p className={own.pin} aria-label={t("pair.pinLabel")}>{pairing.state.pin}</p>
          <p className={styles.note}>{t("pair.waiting", { command: `arlesh-server pin approve ${pairing.state.pin}` })}</p>
          <div className={own.actions}>
            <button className={styles.button} type="button" onClick={pairing.cancel}>{t("pair.cancel")}</button>
          </div>
        </div>
      ) : (
        <div className={own.actions}>
          <button
            className={styles.button}
            type="button"
            disabled={!canPair || isPairing}
            onClick={() => { void pairing.start(url.trim(), name.trim()); }}
          >
            {pairing.state.phase === "starting" ? t("pair.starting") : t("pair.start")}
          </button>
        </div>
      )}
      {pairing.state.phase === "failed" && <p className={styles.error} role="alert">{pairing.state.message}</p>}
      <p className={styles.note}>{t("pair.orToken")}</p>
      <div className={own.field}>
        <label htmlFor={tokenId}>{t("page.token")}</label>
        <input
          id={tokenId}
          className={own.input}
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => { setToken(e.target.value); setCheck(null); }}
        />
      </div>
      {!keychain && (
        <>
          <p className={styles.note}>{t("page.noKeychain")}</p>
          <label className={own.consent}>
            <input type="checkbox" checked={tokenInFile} onChange={(e) => setTokenInFile(e.target.checked)} />
            {t("page.tokenInFile")}
          </label>
        </>
      )}
      <div className={own.actions}>
        <button className={styles.button} type="button" disabled={isBusy || url.trim() === "" || token.trim() === ""} onClick={() => { void test(); }}>
          {isBusy ? t("page.testing") : t("page.test")}
        </button>
        <button
          className={styles.button}
          type="button"
          disabled={isBusy || !ready || check === null || check.read_only !== null}
          onClick={() => { void connect(); }}
        >
          {t("page.connect")}
        </button>
      </div>
      {check !== null && check.read_only === null && (
        <p className={styles.note} role="status">
          {t("page.ok", { version: check.health.version, api: check.health.api_version })}
        </p>
      )}
      {check !== null && check.read_only !== null && (
        <p className={styles.error} role="alert">
          {t("page.incompatible", { reason: t(`banner.${check.read_only}`) })}
        </p>
      )}
      {error !== null && <p className={styles.error} role="alert">{error}</p>}
      {isClient && status?.standalone_available === true && (
        <>
          <p className={styles.note}>{t("page.localKept")}</p>
          <div className={own.actions}>
            <button className={styles.button} type="button" disabled={isBusy} onClick={() => { void standalone(); }}>
              {t("page.useStandalone")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
