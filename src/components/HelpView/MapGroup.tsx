import type { ModelMapGroup } from "@/data/model-map";
import { groupAnchor } from "@/utils/model-map-anchors";
import ConceptCard from "./ConceptCard";
import InlineText from "./InlineText";
import styles from "./HelpView.module.css";

interface Props {
  group: ModelMapGroup;
}

/** A numbered group of the map: its heading and its concept cards. */
export default function MapGroup({ group }: Props) {
  return (
    <section className={`${styles.group} ${styles[`band-${group.band}`] ?? ""}`} id={groupAnchor(group.id)}>
      <div className={styles.groupHead}>
        <span className={styles.eyebrow}>{`${group.number} · ${group.name}`}</span>
        <h2 className={styles.h2}>{group.title}</h2>
        <p className={styles.groupIntro}><InlineText text={group.intro} /></p>
      </div>
      <div className={styles.conceptGrid}>
        {group.cards.map((card) => <ConceptCard key={card.title} card={card} />)}
      </div>
    </section>
  );
}
