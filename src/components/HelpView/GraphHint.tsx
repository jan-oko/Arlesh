import { useTranslation } from "react-i18next";
import type { PlacedGraph } from "@/utils/derivation-graph";
import { labelsOf } from "@/utils/derivation-graph";
import { kindLabel } from "@/utils/graph-kind-label";
import styles from "./HelpView.module.css";

interface Props {
  graph: PlacedGraph;
  hovered: string | null;
  selected: readonly string[];
}

/** The line under the graph: what the hovered or focused box is, what it reads and what reads it. */
export default function GraphHint({ graph, hovered, selected }: Props) {
  const { t } = useTranslation("help");
  const node = graph.nodes.find((candidate) => candidate.id === hovered);
  if (node === undefined) {
    return (
      <div className={styles.hint} aria-live="polite">
        <p className={styles.hintTitle}>{t("hintTitle")}</p>
        <p className={styles.io}>{t("hintDashed")}</p>
      </div>
    );
  }
  const kind = kindLabel(t, node.kind);
  return (
    <div className={styles.hint} aria-live="polite">
      <span className={styles.kind}>{selected.includes(node.id) ? `${kind} · ${t("selectedSuffix")}` : kind}</span>
      <p className={styles.hintTitle}>{node.label}</p>
      <p>{node.text}</p>
      {node.kind !== "in" && <p className={styles.io}>{t("reads")}: {labelsOf(graph, node.reads).join(", ") || t("nothing")}</p>}
      {node.readBy.length > 0 && <p className={styles.io}>{t("readBy")}: {labelsOf(graph, node.readBy).join(", ")}</p>}
      <p className={styles.io}>{t("spec")}: <span className={styles.mono}>{node.spec}</span></p>
    </div>
  );
}
