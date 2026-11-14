import { useTranslation } from "react-i18next";
import type { KeyboardEvent } from "react";
import { GRAPH_BOX_HEIGHT, GRAPH_VIEWBOX } from "@/data/derivation-graph";
import type { DerivationGraphState } from "@/hooks/use-derivation-graph";
import styles from "./HelpView.module.css";

type Props = Pick<DerivationGraphState, "graph" | "hovered" | "selected" | "active" | "linked" | "isArrowActive" | "setHovered" | "toggle">;

const KIND_CLASS = { in: styles.stored, dv: styles.derived, rd: styles.preset } as const;

/**
 * The boxes and arrows. Hover or focus previews a box and lights its links; a click, a tap or
 * Enter / Space pins it. The drawing keeps its size and scrolls on a narrow screen rather than
 * shrinking the text.
 */
export default function DerivationGraph({ graph, hovered, selected, active, linked, isArrowActive, setHovered, toggle }: Props) {
  const { t } = useTranslation("help");
  const focused = hovered !== null || selected.length > 0;

  function onKeyDown(event: KeyboardEvent<SVGGElement>, id: string) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggle(id);
  }

  return (
    <div className={styles.graph}>
      <svg
        className={`${styles.svg} ${focused ? styles.active : ""}`}
        viewBox={`0 0 ${GRAPH_VIEWBOX.width} ${GRAPH_VIEWBOX.height}`}
        role="group"
        aria-label={t("graphLabel")}
      >
        <defs>
          <marker id="help-arrow-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
          </marker>
        </defs>
        <g>
          {graph.edges.map((edge) => (
            <path
              key={`${edge.from}>${edge.to}`}
              d={edge.path}
              markerEnd="url(#help-arrow-head)"
              className={[styles.edge, edge.far ? styles.far : "", isArrowActive(edge.from, edge.to) ? styles.edgeOn : ""].join(" ")}
            />
          ))}
        </g>
        <g>
          {graph.nodes.map((node) => {
            const isSelected = selected.includes(node.id);
            const classes = [
              styles.node,
              KIND_CLASS[node.kind],
              active.has(node.id) ? styles.on : "",
              linked.has(node.id) && !isSelected ? styles.lit : "",
              isSelected ? styles.sel : "",
              hovered === node.id && !isSelected ? styles.hover : "",
            ].join(" ");
            return (
              <g
                key={node.id}
                className={classes}
                tabIndex={0}
                role="button"
                aria-pressed={isSelected}
                aria-label={`${node.label}. ${node.text}`}
                onMouseEnter={() => setHovered(node.id)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(node.id)}
                onBlur={() => setHovered(null)}
                onClick={() => toggle(node.id)}
                onKeyDown={(event) => onKeyDown(event, node.id)}
              >
                <rect x={node.x} y={node.y} width={node.width} height={GRAPH_BOX_HEIGHT} rx={6} />
                <text x={node.x + 10} y={node.y + 17.5}>{node.label}</text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
