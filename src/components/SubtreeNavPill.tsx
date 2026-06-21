import styles from "./SubtreeNavPill.module.css";

interface Props {
  parentTitle: string;
  onBack: () => void;
}

export default function SubtreeNavPill({ parentTitle, onBack }: Props) {
  return (
    <button className={styles.pill} onClick={onBack} type="button">
      ← {parentTitle}
    </button>
  );
}
