import type { ReactNode } from "react";
import styles from "./FilterPopover.module.css";

interface Props {
  label: string;
  children: ReactNode;
}

/** One compact Filter menu row: the dimension's label, then its pills or its search box. */
export default function FilterRow({ label, children }: Props) {
  return (
    <div className={styles.row} role="group" aria-label={label}>
      <span className={styles.rowLabel}>{label}</span>
      {children}
    </div>
  );
}
