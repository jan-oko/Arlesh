import { useTranslation } from "react-i18next";
import type { McpEndpointStatus } from "@/api/mcp-endpoint";
import styles from "./SettingsModal.module.css";
import own from "./McpEndpointSection.module.css";

interface McpListenerLineProps {
  status: McpEndpointStatus;
}

/** One line saying what the MCP listener is doing: starting, listening where, or failed and why. */
export default function McpListenerLine({ status }: McpListenerLineProps) {
  const { t } = useTranslation("settings");
  const { listener } = status;
  switch (listener.state) {
    case "starting":
      return <p className={own.status} role="status">{t("mcp.endpoint.starting")}</p>;
    case "listening":
      return <p className={own.status} role="status">{t("mcp.endpoint.listening", { address: listener.address })}</p>;
    case "failed":
      return (
        <p className={`${own.status} ${styles.error}`} role="status">
          {t("mcp.endpoint.failed", { port: status.port, reason: listener.reason })}
        </p>
      );
  }
}
