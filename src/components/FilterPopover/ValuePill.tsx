import type { CSSProperties, KeyboardEvent, MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { FilterDimension } from "@/utils/filter-modes";
import { isYesNoDimension, modeFromModifiers, nextMode } from "@/utils/filter-modes";
import { PILL_MODE_SYMBOL } from "@/utils/list-filter";
import type { PillMode } from "@/utils/list-filter";
import { modeColorVar, tintBackground } from "@/utils/pill-color";
import styles from "./FilterPopover.module.css";

interface PillStyle extends CSSProperties {
  "--pill-mode-color": string;
  "--chip-tint": string | undefined;
}

interface Props {
  dimension: FilterDimension;
  label: string;
  color: string | null;
  /** The mode it was added in, or `null` while it is not added. */
  mode: PillMode | null;
  /** A yes/no pill's Not wording, for the plain pill's tooltip ("Alt+click: Not blocked"). */
  notLabel?: string;
  onAdd: (mode: PillMode) => void;
  onCycle: () => void;
  onRemove: () => void;
}

/**
 * One value in a Filter menu row. Plain until added — **click / Enter** adds it as All, **Shift**
 * as Any, **Alt** as Not — and then it wears its chip's mode, in step with the top-bar chip:
 * clicking cycles the mode, **Delete** or **Backspace** removes it. It is one button in both states,
 * so a fixed value removed from the keyboard keeps focus where it was.
 */
export default function ValuePill({ dimension, label, color, mode, notLabel, onAdd, onCycle, onRemove }: Props) {
  const { t } = useTranslation("filter");

  function add(event: MouseEvent | KeyboardEvent) {
    onAdd(modeFromModifiers(event));
  }

  const dot = color === null ? null : <span className={styles.dot} style={{ background: color }} aria-hidden="true" />;

  if (mode === null) {
    const title = isYesNoDimension(dimension) && notLabel !== undefined
      ? t("addYesNoTitle", { label, notLabel })
      : t("addPillTitle");
    return (
      <button
        type="button"
        className={styles.pill}
        title={title}
        onClick={add}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          add(event);
        }}
      >
        {dot}
        {label}
      </button>
    );
  }

  const pillStyle: PillStyle = { "--pill-mode-color": modeColorVar(mode), "--chip-tint": tintBackground(color) };
  const modeName = t(`tagMode.${mode}`);
  return (
    <button
      type="button"
      data-set-pill=""
      className={`${styles.pill} ${styles.setPill}`}
      style={pillStyle}
      title={t("setPillTitle", { mode: modeName, next: t(`tagMode.${nextMode(mode)}`) })}
      aria-label={t("setPillAria", { label, mode: modeName })}
      onClick={onCycle}
      onKeyDown={(event) => {
        if (event.key !== "Delete" && event.key !== "Backspace") return;
        event.preventDefault();
        onRemove();
      }}
    >
      <span className={styles.symbol} aria-hidden="true">{PILL_MODE_SYMBOL[mode]}</span>
      <span className={mode === "exclude" ? styles.struck : undefined}>{label}</span>
    </button>
  );
}
