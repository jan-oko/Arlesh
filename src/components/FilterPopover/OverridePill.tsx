import type { OverrideMode } from "@/utils/filter-tree";
import styles from "./FilterPopover.module.css";

interface Props {
  label: string;
  mode: OverrideMode;
  /** Says what the current mode does and how the pill cycles. */
  title: string;
  onCycle: () => void;
}

/** The pill's classes for a given mode. */
function overridePillClass(mode: OverrideMode): string {
  if (mode === "include") return `${styles.overridePill} ${styles.overridePillInclude}`;
  if (mode === "exclude") return `${styles.overridePill} ${styles.overridePillExclude}`;
  return styles.overridePill ?? "";
}

/** A tri-state pill — Archived, Backlog — cycling off (as the preset says) → include → exclude. */
export default function OverridePill({ label, mode, title, onCycle }: Props) {
  return (
    <button type="button" className={overridePillClass(mode)} title={title} onClick={onCycle}>
      {label}
    </button>
  );
}
