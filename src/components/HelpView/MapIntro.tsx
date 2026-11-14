import { useTranslation } from "react-i18next";
import { MODEL_MAP_GROUPS, MODEL_MAP_HEADER } from "@/data/model-map";
import { groupAnchor, scrollToAnchor } from "@/utils/model-map-anchors";
import InlineText from "./InlineText";
import styles from "./HelpView.module.css";

/** The map's opening: what it is, and a list to jump to each group. */
export default function MapIntro() {
  const { t } = useTranslation("help");
  return (
    <>
      <header className={styles.intro}>
        <span className={styles.eyebrow}>{MODEL_MAP_HEADER.eyebrow}</span>
        <h1 className={styles.h1}>{MODEL_MAP_HEADER.title}</h1>
        <p className={styles.lede}>{MODEL_MAP_HEADER.lede}</p>
        <p><InlineText text={MODEL_MAP_HEADER.note} /></p>
      </header>
      <nav aria-label={t("groups")}>
        <ol className={styles.jump}>
          {MODEL_MAP_GROUPS.map((group) => (
            <li key={group.id}>
              <button type="button" className={styles.jumpLink} onClick={() => scrollToAnchor(groupAnchor(group.id))}>
                <span>{group.number}</span>{group.name}
              </button>
            </li>
          ))}
        </ol>
      </nav>
    </>
  );
}
