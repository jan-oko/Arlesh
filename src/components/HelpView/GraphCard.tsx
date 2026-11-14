import { useTranslation } from "react-i18next";
import { GRAPH_CARD_OF, GRAPH_NOTES } from "@/data/derivation-graph";
import { MODEL_MAP_CARDS } from "@/data/model-map";
import { cardAnchor, scrollToAnchor } from "@/utils/model-map-anchors";
import type { PlacedGraph, PlacedNode } from "@/utils/derivation-graph";
import { labelsOf } from "@/utils/derivation-graph";
import { kindLabel } from "@/utils/graph-kind-label";
import styles from "./HelpView.module.css";

interface Props {
  node: PlacedNode;
  graph: PlacedGraph;
  onDeselect: () => void;
}

const CLOSE_GLYPH = "×";

/** A pinned box's card: what it is, what it reads, why it exists and where it lives. */
export default function GraphCard({ node, graph, onDeselect }: Props) {
  const { t } = useTranslation("help");
  const note = GRAPH_NOTES[node.id];
  const conceptName = GRAPH_CARD_OF[node.id];
  return (
    <article className={styles.card}>
      <div className={styles.cardTop}>
        <div>
          <span className={styles.kind}>{kindLabel(t, node.kind)}</span>
          <h3 className={styles.cardTitle}>{node.label}</h3>
        </div>
        <button type="button" className={styles.cardX} aria-label={t("deselect", { name: node.label })} onClick={onDeselect}>
          {CLOSE_GLYPH}
        </button>
      </div>
      <p className={styles.cardText}>{node.text}</p>
      <dl className={styles.facts}>
        {node.kind !== "in" && (<><dt>{t("reads")}</dt><dd>{labelsOf(graph, node.reads).join(", ") || t("nothing")}</dd></>)}
        {node.readBy.length > 0 && (<><dt>{t("readBy")}</dt><dd>{labelsOf(graph, node.readBy).join(", ")}</dd></>)}
        {note !== undefined && (
          <>
            <dt>{t("why")}</dt><dd>{note.why}</dd>
            <dt>{t("without")}</dt><dd>{note.without}</dd>
            <dt>{t("lives")}</dt><dd className={styles.mono}>{note.lives}</dd>
          </>
        )}
        <dt>{t("spec")}</dt><dd className={styles.mono}>{node.spec}</dd>
      </dl>
      {conceptName !== undefined && MODEL_MAP_CARDS.has(conceptName) && (
        <button type="button" className={styles.conceptLink} onClick={() => scrollToAnchor(cardAnchor(conceptName))}>
          {t("onMapPage")}: {conceptName}
        </button>
      )}
    </article>
  );
}
