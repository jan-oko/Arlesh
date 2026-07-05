import type { ReactNode } from "react";
import styles from "./FilterPopover.module.css";

interface Props {
  label: string;
  children: ReactNode;
}

/** A labeled section wrapping one filter dimension's add-control (search combobox or fixed-option
 * pill row). Active pills render as chips in the TopBar, not here — this is purely "add a filter". */
export default function PillFilterSection({ label, children }: Props) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionLabel}>{label}</div>
      {children}
    </section>
  );
}
