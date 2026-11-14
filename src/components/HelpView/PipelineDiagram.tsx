import { PIPELINE_DESCRIPTION, PIPELINE_TEXTS, PIPELINE_VIEWBOX } from "@/data/model-map-pipeline";
import type { PipelineTone } from "@/data/model-map-pipeline";
import styles from "./HelpView.module.css";

const TONE_CLASS: Readonly<Record<PipelineTone, string>> = {
  text: "",
  muted: styles.toneMuted ?? "",
  stored: styles.toneStored ?? "",
  derived: styles.toneDerived ?? "",
  read: styles.toneRead ?? "",
};

/** The load's five steps, as the soft boxes inside the board-load frame. */
const LOAD_STEPS: readonly number[] = [54, 92, 130, 168, 206];

/** The pipeline: stored rows, the board load, the filters and their readers, and the way back. */
export default function PipelineDiagram() {
  return (
    <div className={styles.diagram}>
      <svg
        className={`${styles.svg} ${styles.pipelineSvg}`}
        viewBox={`0 0 ${PIPELINE_VIEWBOX.width} ${PIPELINE_VIEWBOX.height}`}
        role="img"
        aria-label={PIPELINE_DESCRIPTION}
      >
        <defs>
          <marker id="help-pipeline-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
          </marker>
        </defs>
        <rect x="10" y="40" width="200" height="250" rx="10" className={`${styles.frame} ${styles.frameStored}`} />
        <rect x="270" y="40" width="250" height="250" rx="10" className={`${styles.frame} ${styles.frameDerived}`} />
        {LOAD_STEPS.map((y) => (
          <rect key={y} x="286" y={y} width="218" height="30" rx="6" className={styles.step} />
        ))}
        {[84, 122, 160, 198].map((y) => (
          <line key={y} x1="395" y1={y} x2="395" y2={y + 8} stroke="currentColor" />
        ))}
        <rect x="580" y="95" width="160" height="140" rx="10" className={`${styles.frame} ${styles.frameRead}`} />
        <rect x="800" y="40" width="170" height="110" rx="10" className={`${styles.frame} ${styles.frameText}`} />
        <rect x="800" y="180" width="170" height="110" rx="10" className={`${styles.frame} ${styles.frameText}`} />
        <g stroke="currentColor" strokeWidth="1.5" fill="none" markerEnd="url(#help-pipeline-head)">
          <line x1="212" y1="165" x2="266" y2="165" />
          <line x1="522" y1="165" x2="576" y2="165" />
          <path d="M742 140 C770 140 770 95 796 95" />
          <path d="M742 190 C770 190 770 235 796 235" />
        </g>
        <path
          d="M885 290 L885 350 L110 350 L110 294"
          className={styles.writeBack}
          markerEnd="url(#help-pipeline-head)"
        />
        <line x1="885" y1="150" x2="885" y2="178" className={styles.writeBack} />
        <rect x="10" y="378" width="200" height="40" rx="8" className={styles.journal} />
        <line x1="60" y1="290" x2="60" y2="374" stroke="currentColor" strokeWidth="1.2" markerEnd="url(#help-pipeline-head)" />
        <g className={styles.pipelineText}>
          {PIPELINE_TEXTS.map((label) => (
            <text
              key={`${label.x},${label.y}`}
              x={label.x}
              y={label.y}
              textAnchor={label.anchor ?? "start"}
              className={`${TONE_CLASS[label.tone ?? "text"]} ${label.bold === true ? styles.bold : ""}`}
              {...(label.size === undefined ? {} : { fontSize: label.size })}
            >
              {label.text}
            </text>
          ))}
        </g>
      </svg>
    </div>
  );
}
