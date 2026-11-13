import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useInputCapture } from "@/hooks/use-input-capture";
import { useDerivationGraph } from "@/hooks/use-derivation-graph";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import DerivationGraph from "./DerivationGraph";
import GraphHint from "./GraphHint";
import GraphCard from "./GraphCard";
import styles from "./HelpView.module.css";

interface Props {
  onClose: () => void;
}

const CLOSE_GLYPH = "×";

/**
 * Help: a full view, left like a modal. It takes the whole window and draws over the tab, which
 * stays mounted beneath it — so the close button or Esc returns to the view exactly as it was, with
 * its tab, selection and scroll. For now it holds the derivation graph only.
 *
 * It holds the keyboard while open (`useInputCapture`), so the view's chords stay off behind it, and
 * takes Esc in the capture phase as the cheat-sheet does, so one press closes one thing.
 */
export default function HelpView({ onClose }: Props) {
  useInputCapture();
  const { t } = useTranslation("help");
  const trap = useFocusTrap<HTMLDivElement>();
  const state = useDerivationGraph();
  const { graph, selected, clear, toggle } = state;

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
      onClose();
    }
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [onClose]);

  return (
    <div ref={trap} className={styles.view} role="dialog" aria-modal="true" aria-label={t("title")}>
      <header className={styles.header}>
        <div className={styles.titles}>
          <h2 className={styles.title}>{t("title")}</h2>
          <h3 className={styles.subtitle}>{t("graphTitle")}</h3>
        </div>
        <button type="button" className={styles.close} aria-label={t("close")} title={t("close")} onClick={onClose} autoFocus>
          {CLOSE_GLYPH}
        </button>
      </header>
      <div className={styles.body}>
        <p className={styles.intro}>{t("graphIntro")}</p>
        <div className={styles.legend} aria-hidden="true">
          <span><i className={`${styles.swatch} ${styles.swatchStored}`} />{t("legendStored")}</span>
          <span><i className={`${styles.swatch} ${styles.swatchDerived}`} />{t("legendDerived")}</span>
          <span><i className={`${styles.swatch} ${styles.swatchPreset}`} />{t("legendPreset")}</span>
          <span><i className={`${styles.swatch} ${styles.swatchSelected}`} />{t("legendSelected")}</span>
        </div>
        <div className={styles.layout}>
          <div className={styles.left}>
            <DerivationGraph {...state} />
            <GraphHint graph={graph} hovered={state.hovered} selected={selected} />
          </div>
          <aside className={styles.aside} aria-label={t("selectedCount", { count: selected.length })}>
            <div className={styles.asideHead}>
              <h3 className={styles.asideTitle}>{t("selectedCount", { count: selected.length })}</h3>
              <button type="button" className={styles.clear} disabled={selected.length === 0} onClick={clear}>
                {t("clear")}
              </button>
            </div>
            {selected.length === 0 && <p className={styles.empty}>{t("empty")}</p>}
            <div className={styles.cards}>
              {selected.map((id) => {
                const node = graph.nodes.find((candidate) => candidate.id === id);
                return node === undefined ? null : <GraphCard key={id} node={node} graph={graph} onDeselect={() => toggle(id)} />;
              })}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
