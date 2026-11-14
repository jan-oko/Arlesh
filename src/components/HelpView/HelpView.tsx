import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MODEL_MAP_FOOTER, MODEL_MAP_GROUPS, MODEL_MAP_PIPELINE_CAPTION } from "@/data/model-map";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { useInputCapture } from "@/hooks/use-input-capture";
import DerivationSection from "./DerivationSection";
import InlineText from "./InlineText";
import MapGroup from "./MapGroup";
import MapIntro from "./MapIntro";
import PipelineDiagram from "./PipelineDiagram";
import styles from "./HelpView.module.css";

interface Props {
  onClose: () => void;
}

const CLOSE_GLYPH = "×";

/**
 * Help: a full view, left like a modal. It takes the whole window and draws over the tab, which
 * stays mounted beneath it — so the close button or Esc returns to the view exactly as it was, with
 * its tab, selection and scroll. (The graph can be expanded to fill it, and Esc leaves that first.) It shows the concept map as one scrolling page: how Arlesh fits
 * together, with the derivation graph in its place. There is no bar: the close button floats over
 * the corner.
 *
 * It holds the keyboard while open (`useInputCapture`), so the view's chords stay off behind it, and
 * takes Esc in the capture phase as the cheat-sheet does, so one press closes one thing.
 */
export default function HelpView({ onClose }: Props) {
  useInputCapture();
  const { t } = useTranslation("help");
  const trap = useFocusTrap<HTMLDivElement>();
  const closeRef = useRef<HTMLButtonElement>(null);
  const [graphExpanded, setGraphExpanded] = useState(false);

  // Help opens with the close button focused, as a dialog does; leaving the expanded graph keeps focus where it was.
  useEffect(() => { closeRef.current?.focus(); }, []);

  // Leaving Help hands the keyboard back to whatever held it when Help opened.
  useEffect(() => {
    const opener = document.activeElement;
    return () => { if (opener instanceof HTMLElement) opener.focus(); };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.code !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      // The expanded graph is left first: one press closes one thing.
      if (graphExpanded) setGraphExpanded(false);
      else onClose();
    }
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [onClose, graphExpanded]);

  return (
    <div ref={trap} className={styles.view} role="dialog" aria-modal="true" aria-label={t("title")}>
      {/* While the graph is expanded its collapse button takes this corner, so there is one button here. */}
      {!graphExpanded && (
        <button type="button" ref={closeRef} className={styles.close} aria-label={t("close")} title={t("close")} onClick={onClose}>
          {CLOSE_GLYPH}
        </button>
      )}
      <div className={styles.wrap}>
        <MapIntro />
        <figure className={styles.figure}>
          <PipelineDiagram />
          <figcaption className={styles.caption}>{MODEL_MAP_PIPELINE_CAPTION}</figcaption>
          <div className={styles.legend} aria-hidden="true">
            <span><i className={`${styles.swatch} ${styles.swatchStored}`} />{t("legendPipelineStored")}</span>
            <span><i className={`${styles.swatch} ${styles.swatchDerived}`} />{t("legendDerived")}</span>
            <span><i className={`${styles.swatch} ${styles.swatchPreset}`} />{t("legendReadSide")}</span>
          </div>
        </figure>
        <DerivationSection expanded={graphExpanded} onToggleExpanded={() => setGraphExpanded((now) => !now)} />
        {MODEL_MAP_GROUPS.map((group) => <MapGroup key={group.id} group={group} />)}
        <footer className={styles.footer}><InlineText text={MODEL_MAP_FOOTER} /></footer>
      </div>
    </div>
  );
}
