import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { NodeKind } from "@/utils/tree-layout";
import type { SearchableNode } from "@/utils/mindmap-tree";
import { disambiguations } from "@/utils/search-disambiguation";
import { useInputCapture } from "@/hooks/use-input-capture";
import SearchModalShell from "@/components/SearchModalShell/SearchModalShell";
import styles from "./NodeSearchModal.module.css";

export type { SearchableNode };

interface Props {
  nodes: SearchableNode[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

const MAX_RESULTS = 50;

// Primary sort order for results, by kind. Kinds not listed sort after these, in their original order.
const KIND_ORDER: NodeKind[] = ["aspect", "project", "domain", "flow", "goal", "task", "info"];
function kindRank(kind: NodeKind): number {
  const i = KIND_ORDER.indexOf(kind);
  return i === -1 ? KIND_ORDER.length : i;
}

/** Ctrl+O node search: type to filter nodes by title, select one to enter it as the display subtree. */
export default function NodeSearchModal({ nodes, onSelect, onClose }: Props) {
  useInputCapture();
  const { t } = useTranslation(["common", "nodeKinds"]);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return []; // nothing until the user types
    const matches = nodes.filter((n) => n.title.toLowerCase().includes(q));
    // Stable sort by kind keeps tree order within each kind.
    return [...matches].sort((a, b) => kindRank(a.kind) - kindRank(b.kind)).slice(0, MAX_RESULTS);
  }, [nodes, query]);

  const details = useMemo(() => disambiguations(results), [results]);
  const hasQuery = query.trim() !== "";
  const clampedActive = Math.min(active, Math.max(0, results.length - 1));

  function commit(index: number) {
    const node = results[index];
    if (node !== undefined) onSelect(node.id);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      commit(clampedActive);
    }
  }

  return (
    <SearchModalShell
      label={t("common:searchNodesPlaceholder")}
      placeholder={t("common:searchNodesPlaceholder")}
      query={query}
      onQueryChange={(next) => { setQuery(next); setActive(0); }}
      onKeyDown={handleKeyDown}
      onClose={onClose}
    >
      {hasQuery && results.length === 0 && <div className={styles.empty}>{t("common:noResults")}</div>}
      {hasQuery && results.length > 0 && (
        <ul className={styles.results}>
          {results.map((node, i) => {
            const detail = details.get(node.id);
            return (
              <li
                key={node.id}
                className={`${styles.result}${i === clampedActive ? ` ${styles.active}` : ""}`}
                onMouseDown={(e) => { e.preventDefault(); commit(i); }}
                onMouseEnter={() => setActive(i)}
              >
                <span className={styles.label}>
                  <span className={styles.title}>{node.title}</span>
                  {detail !== undefined && detail !== "" && <span className={styles.parentPath}>({detail})</span>}
                </span>
                <span className={styles.kind}>{t(`nodeKinds:${node.kind}`)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </SearchModalShell>
  );
}
