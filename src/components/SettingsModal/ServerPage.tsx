import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { connectToServer, keychainAvailable, testServer, runStandalone } from "@/api/client-mode";
import type { ServerCheck } from "@/api/client-mode";
import { getErrorMessage } from "@/api/errors";
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
  const urlId = useId();
  const tokenId = useId();

  useEffect(() => {
    keychainAvailable().then(setKeychain).catch(() => setKeychain(false));
  }, []);

  const isClient = status?.mode === "client";
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
