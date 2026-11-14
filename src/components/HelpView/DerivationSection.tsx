import { useTranslation } from "react-i18next";
import { MODEL_MAP_GRAPH_SECTION } from "@/data/model-map";
import { useDerivationGraph } from "@/hooks/use-derivation-graph";
import { groupAnchor } from "@/utils/model-map-anchors";
import DerivationGraph from "./DerivationGraph";
import GraphCard from "./GraphCard";
import GraphHint from "./GraphHint";
import InlineText from "./InlineText";
import styles from "./HelpView.module.css";

/** The derivation graph in its place in the map: the graph, the hover line, and the pinned cards. */
export default function DerivationSection() {
  const { t } = useTranslation("help");
  const state = useDerivationGraph();
  const { graph, selected, clear, toggle } = state;
  return (
    <section className={`${styles.group} ${styles["band-derived"] ?? ""}`} id={groupAnchor("graph")}>
      <div className={styles.groupHead}>
        <span className={styles.eyebrow}>{MODEL_MAP_GRAPH_SECTION.eyebrow}</span>
        <h2 className={styles.h2}>{MODEL_MAP_GRAPH_SECTION.title}</h2>
        <p className={styles.groupIntro}><InlineText text={MODEL_MAP_GRAPH_SECTION.intro} /></p>
      </div>
      <DerivationGraph {...state} />
      <div className={styles.legend} aria-hidden="true">
        <span><i className={`${styles.swatch} ${styles.swatchStored}`} />{t("legendStored")}</span>
        <span><i className={`${styles.swatch} ${styles.swatchDerived}`} />{t("legendDerived")}</span>
        <span><i className={`${styles.swatch} ${styles.swatchPreset}`} />{t("legendPreset")}</span>
        <span><i className={`${styles.swatch} ${styles.swatchSelected}`} />{t("legendSelected")}</span>
      </div>
      <GraphHint graph={graph} hovered={state.hovered} selected={selected} />
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
  );
}
