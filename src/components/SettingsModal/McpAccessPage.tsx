import { useState } from "react";
import { useTranslation } from "react-i18next";
import { mcpNodeKeyString } from "@/api/mcp-access";
import { useMcpRoots } from "@/hooks/use-mcp-roots";
import NodeSearchModal from "@/components/NodeSearchModal/NodeSearchModal";
import styles from "./SettingsModal.module.css";

const REMOVE_GLYPH = "×";

/**
 * The MCP roots: the parts of the board the MCP may see. Add one with the node search `Ctrl+O`
 * uses, remove one with its ×. Each change is one undoable step.
 */
export default function McpAccessPage() {
  const { t } = useTranslation(["settings", "nodeKinds"]);
  const { roots, candidates, isLoading, error, addRoot, removeRoot } = useMcpRoots();
  const [searching, setSearching] = useState(false);

  return (
    <div className={styles.page}>
      <p className={styles.note}>{t("settings:mcp.intro")}</p>
      <div>
        <button className={styles.button} type="button" onClick={() => setSearching(true)} disabled={isLoading}>
          {t("settings:mcp.add")}
        </button>
      </div>
      {error !== null && <p className={styles.error} role="alert">{error}</p>}
      {isLoading && <p className={styles.note}>{t("settings:mcp.loading")}</p>}
      {!isLoading && roots.length === 0 && <p className={styles.note}>{t("settings:mcp.none")}</p>}
      {roots.length > 0 && (
        <ul className={styles.roots} aria-label={t("settings:mcp.list")}>
          {roots.map((root) => {
            const title = root.title ?? t("settings:mcp.missing");
            return (
              <li key={mcpNodeKeyString(root.key)} className={styles.root}>
                <span className={styles.rootText}>
                  <span className={styles.rootTitle}>{title}</span>
                  {root.path.length > 0 && <span className={styles.rootPath}>{root.path.join(" › ")}</span>}
                  {!root.visible && root.title !== null && <span className={styles.rootHidden}>{t("settings:mcp.hidden")}</span>}
                </span>
                {root.kind !== null && <span className={styles.rootKind}>{t(`nodeKinds:${root.kind}`)}</span>}
                <button
                  className={styles.remove}
                  type="button"
                  aria-label={t("settings:mcp.remove", { title })}
                  title={t("settings:mcp.remove", { title })}
                  onClick={() => { void removeRoot(root.key); }}
                >
                  {REMOVE_GLYPH}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {searching && (
        <NodeSearchModal
          nodes={candidates}
          onSelect={(id) => { setSearching(false); void addRoot(id); }}
          onClose={() => setSearching(false)}
        />
      )}
    </div>
  );
}
