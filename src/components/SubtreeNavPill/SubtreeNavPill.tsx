import { useTranslation } from "react-i18next";
import styles from "./SubtreeNavPill.module.css";

interface Props {
  parentTitle: string;
  onBack: () => void;
}

export default function SubtreeNavPill({ parentTitle, onBack }: Props) {
  const { i18n } = useTranslation();
  const arrow = i18n.dir() === "rtl" ? "→" : "←";
  return (
    <button className={styles.pill} onClick={onBack} type="button">
      {arrow} {parentTitle}
    </button>
  );
}
