import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MODEL_MAP_GRAPH_SECTION } from "@/data/model-map";
import { useDerivationGraph } from "@/hooks/use-derivation-graph";
import { groupAnchor } from "@/utils/model-map-anchors";
import DerivationGraph from "./DerivationGraph";
import GraphCard from "./GraphCard";
import GraphHint from "./GraphHint";
import InlineText from "./InlineText";
import styles from "./HelpView.module.css";

interface Props {
  /** Whether the graph fills the whole Help view instead of sitting in the page. */
  expanded: boolean;
  onToggleExpanded: () => void;
}

const EXPAND_GLYPH = "⤢";
const COLLAPSE_GLYPH = "⤡";

/**
 * The derivation graph in its place in the map: the graph, the hover line, and the pinned cards.
 * The button beside its heading expands it to fill the whole Help view, and the same button, or
 * Esc, returns to the page. The page stays mounted, and the graph's slot in it keeps its height
 * while the graph is out, so the page is at the same place when it comes back.
 */
export default function DerivationSection({ expanded, onToggleExpanded }: Props) {
  const { t } = useTranslation("help");
  const slotRef = useRef<HTMLDivElement>(null);
  const [slotHeight, setSlotHeight] = useState<number | null>(null);
  // Measured as the graph leaves the page, and held only while it is out, so the page does not shrink under the reader.
  function toggleExpanded() {
    if (!expanded) setSlotHeight(slotRef.current?.offsetHeight ?? null);
    onToggleExpanded();
  }
  const label = expanded ? t("collapseGraph") : t("expandGraph");
  const state = useDerivationGraph();
  const { graph, selected, clear, toggle } = state;
  return (
    <div ref={slotRef} {...(!expanded || slotHeight === null ? {} : { style: { minHeight: slotHeight } })}>
    <section
      className={`${styles.group} ${styles["band-derived"] ?? ""} ${expanded ? styles.expanded : ""}`}
      id={groupAnchor("graph")}
      {...(expanded ? { role: "region", "aria-label": MODEL_MAP_GRAPH_SECTION.title } : {})}
    >
      <div className={styles.graphHead}>
        <div className={styles.groupHead}>
          <span className={styles.eyebrow}>{MODEL_MAP_GRAPH_SECTION.eyebrow}</span>
          <h2 className={styles.h2}>{MODEL_MAP_GRAPH_SECTION.title}</h2>
          <p className={styles.groupIntro}><InlineText text={MODEL_MAP_GRAPH_SECTION.intro} /></p>
        </div>
        <button type="button" className={styles.expand} aria-label={label} title={label} aria-pressed={expanded} onClick={toggleExpanded}>
          {expanded ? COLLAPSE_GLYPH : EXPAND_GLYPH}
        </button>
      </div>
      <div className={styles.graphMain}>
      <DerivationGraph {...state} />
      <div className={styles.legend} aria-hidden="true">
        <span><i className={`${styles.swatch} ${styles.swatchStored}`} />{t("legendStored")}</span>
        <span><i className={`${styles.swatch} ${styles.swatchDerived}`} />{t("legendDerived")}</span>
        <span><i className={`${styles.swatch} ${styles.swatchPreset}`} />{t("legendPreset")}</span>
        <span><i className={`${styles.swatch} ${styles.swatchSelected}`} />{t("legendSelected")}</span>
      </div>
      <GraphHint graph={graph} hovered={state.hovered} selected={selected} />
      </div>
      <div className={styles.pinned} aria-label={t("selectedCount", { count: selected.length })} role="region">
        <div className={styles.asideHead}>
          <h3 className={styles.asideTitle}>{t("selectedCount", { count: selected.length })}</h3>
          <button type="button" className={styles.clear} disabled={selected.length === 0} onClick={clear}>
            {t("clear")}
          </button>
        </div>
        {selected.length === 0 && <p className={styles.empty}>{t("empty")}</p>}
        <div className={styles.cards}>
          {selected.map((id) => {
            const node = graph.nodes.find((candidate) => candidate.id === id);
            return node === undefined ? null : <GraphCard key={id} node={node} graph={graph} onDeselect={() => toggle(id)} />;
          })}
        </div>
      </div>
    </section>
    </div>
  );
}
