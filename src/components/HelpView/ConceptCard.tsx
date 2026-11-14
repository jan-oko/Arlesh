import { useTranslation } from "react-i18next";
import type { ModelMapCard } from "@/data/model-map";
import { cardAnchor } from "@/utils/model-map-anchors";
import InlineText from "./InlineText";
import styles from "./HelpView.module.css";

interface Props {
  card: ModelMapCard;
}

/** One concept of the map: what it is, why it exists, what breaks without it, where it lives. */
export default function ConceptCard({ card }: Props) {
  const { t } = useTranslation("help");
  return (
    <article className={styles.concept} id={cardAnchor(card.title)}>
      <h3 className={styles.conceptTitle}>{card.title}</h3>
      <p className={styles.conceptIs}><InlineText text={card.is} /></p>
      <dl className={styles.conceptFacts}>
        <dt>{t("why")}</dt><dd><InlineText text={card.why} /></dd>
        <dt>{t("without")}</dt><dd><InlineText text={card.without} /></dd>
        <dt>{t("lives")}</dt><dd className={styles.mono}>{card.lives}</dd>
      </dl>
    </article>
  );
}
