import { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { NodeKind } from "@/utils/tree-layout";
import styles from "./NodeSearchModal.module.css";

/** A searchable node row. */
export interface SearchableNode { id: string; title: string; kind: NodeKind }

interface Props {
  nodes: SearchableNode[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

const MAX_RESULTS = 50;

/** Ctrl+O node search: type to filter nodes by title, select one to enter it as the display subtree. */
export default function NodeSearchModal({ nodes, onSelect, onClose }: Props) {
  const { t } = useTranslation(["common", "nodeKinds"]);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q === "" ? nodes : nodes.filter((n) => n.title.toLowerCase().includes(q));
    return matches.slice(0, MAX_RESULTS);
  }, [nodes, query]);

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
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => { e.stopPropagation(); }}>
        <input
          autoFocus
          type="text"
          className={styles.input}
          placeholder={t("common:searchNodesPlaceholder")}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(0); }}
          onKeyDown={handleKeyDown}
        />
        {results.length === 0 ? (
          <div className={styles.empty}>{t("common:noResults")}</div>
        ) : (
          <ul className={styles.results} ref={listRef}>
            {results.map((node, i) => (
              <li
                key={node.id}
                className={`${styles.result}${i === clampedActive ? ` ${styles.active}` : ""}`}
                onMouseDown={(e) => { e.preventDefault(); commit(i); }}
                onMouseEnter={() => setActive(i)}
              >
                <span className={styles.title}>{node.title}</span>
                <span className={styles.kind}>{t(`nodeKinds:${node.kind}`)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
