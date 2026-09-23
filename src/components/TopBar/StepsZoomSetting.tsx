import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useViewStore } from "@/stores/use-view-store";
import { STEPS_ZOOM_LEVELS, isStepsZoom } from "@/utils/steps-grid";
import styles from "./HabitCollapseSetting.module.css";

/**
 * How big a Steps card is drawn — and therefore how many of them a page holds.
 *
 * **Per tab**, like the Mindmap's branch axis beside it: one tab walking a wide branch wants small
 * cards while another reads one Task's fields at full size. It is a slider rather than a number
 * because the five levels are sizes, not a quantity — there is no card width you would type.
 *
 * The popover shows it only while Steps is the active view, the way the branch axis and the fold
 * threshold are gated to the Mindmap: a control for something the current view cannot show is noise.
 */
export default function StepsZoomSetting() {
  const { t } = useTranslation("stepsView");
  const zoom = useViewStore((s) => s.stepsZoom);
  const setZoom = useViewStore((s) => s.setStepsZoom);
  const inputId = useId();

  const first = STEPS_ZOOM_LEVELS[0];
  const last = STEPS_ZOOM_LEVELS[STEPS_ZOOM_LEVELS.length - 1];

  return (
    <div className={styles.row}>
      <label htmlFor={inputId}>{t("zoomLabel")}</label>
      <span className={styles.field}>
        <input
          id={inputId}
          type="range"
          min={first}
          max={last}
          step={1}
          value={zoom}
          onChange={(e) => {
            const next = Number.parseInt(e.target.value, 10);
            if (isStepsZoom(next)) setZoom(next);
          }}
        />
        <span className={styles.unit}>{zoom}</span>
      </span>
    </div>
  );
}
