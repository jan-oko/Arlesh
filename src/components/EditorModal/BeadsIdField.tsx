import { useTranslation } from "react-i18next";
import styles from "./EditorModal.module.css";

interface Props {
  /** The `bd` issue this node is tracked as, or `undefined` when it is tracked as none. */
  beadsId: string | undefined;
}

/**
 * Read-only row naming the **bd issue** a Task, Goal or Project is tracked as.
 *
 * The link is written by the MCP server alone — no command and no control in this app can change
 * it — so it is shown as plain text rather than in an input, the same way the dependency-derived
 * block reasons are. A node with no link renders **nothing at all**: no label, no placeholder.
 */
export default function BeadsIdField({ beadsId }: Props) {
  const { t } = useTranslation("editor");
  if (beadsId === undefined || beadsId.trim() === "") return null;
  return (
    <div className={styles.label}>
      {t("fieldBeadsId")}
      <span className={styles.readOnlyValue}>{beadsId}</span>
    </div>
  );
}
