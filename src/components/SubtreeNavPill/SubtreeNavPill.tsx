import { useTranslation } from "react-i18next";
import styles from "./SubtreeNavPill.module.css";

interface Props {
  parentTitle: string;
  rootTitle: string;
  onBack: () => void;
  onBackToRoot?: () => void;
}

export default function SubtreeNavPill({ parentTitle, rootTitle, onBack, onBackToRoot }: Props) {
  const { i18n } = useTranslation();
  const arrow = i18n.dir() === "rtl" ? "→" : "←";
  return (
    <div className={styles.container}>
      {onBackToRoot !== undefined && (
        <button className={styles.pill} onClick={onBackToRoot} type="button">
          ↑ {rootTitle}
        </button>
      )}
      <button className={styles.pill} onClick={onBack} type="button">
        {arrow} {parentTitle}
      </button>
    </div>
  );
}
