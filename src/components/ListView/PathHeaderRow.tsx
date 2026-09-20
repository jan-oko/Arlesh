import { Fragment } from "react";
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { PillSide } from "@/utils/list-filter";
import type { MindmapNode } from "@/utils/tree-layout";
import { isNodeBlocked } from "@/utils/tree-layout";
import NodeIcon from "@/components/NodeIcon/NodeIcon";
import styles from "./PathHeaderRow.module.css";

interface Props {
  segments: readonly MindmapNode[];
  onEnterSubtree: (id: string) => void;
  /** Files the segment as an **Antecedent** pill — kept in (`include`) or kept out (`exclude`). */
  onFilterByAntecedent: (id: string, side: PillSide) => void;
  /** Whether to draw the leading kind glyph — the settings popover's **Path icons** switch. */
  showKindIcon: boolean;
  /** Creates a Task under the chain's last node. `null` where that node cannot hold one, so the
   * affordance is absent rather than present and always refusing. */
  onCreateTask: (() => void) | null;
}

/** Sized against the header's `--text-sm`, not against a TaskRow card's larger status icon. */
const ICON_R = 7;

/**
 * Which side of the Antecedent filter a click on a segment is asking for, or `null` for a bare
 * click, which is not a filter gesture at all.
 *
 * `Ctrl` is read together with `Meta` because that is how every other modifier-click in the app
 * reads it (see the Mindmap node's own Ctrl-click); the app runs on Linux, where `Ctrl` is the one
 * that gets pressed. `Ctrl` is tested first, so `Ctrl+Alt+click` narrows *to* the segment rather
 * than resolving on the order the fields happen to be checked in.
 */
function filterSideFor(event: MouseEvent): PillSide | null {
  if (event.ctrlKey || event.metaKey) return "include";
  if (event.altKey) return "exclude";
  return null;
}
/** The `+` glyph, a shade smaller than the kind icon: it qualifies the chain rather than heading it. */
const PLUS_SIZE = 10;

/** The location of the run of rows beneath it — `Growth › CODE › ARLESH › Features` — named once
 * rather than repeated on every card. Carries every ancestor not rendered as a row above the task
 * (SPEC List View: always through to the Goal, including any ancestor Task the filter hides), so it
 * and the rows' indentation never say the same thing twice.
 *
 * A segment answers three gestures, and the split between them is **plain click re-roots,
 * modifier click narrows**. A bare click *enters* the segment as the subtree — the same re-rooting
 * Ctrl+O performs, shared with the Mindmap — which rebuilds the rows with that node as the frame,
 * so everything outside the branch is never built. `Ctrl+click` and `Alt+click` instead file the
 * segment as an **Antecedent** pill, included or excluded: the flatten is left alone and the
 * result is filtered, a chip at the top of the screen names what is narrowing, and the rest of the
 * board is one chip-click from coming back. Same node, two different questions.
 *
 * They live here because this is the element that already names the ancestors. With the card's
 * parent label gone — the header had made it a restatement — the only other route to an Antecedent
 * pill is typing a node's name into the filter popover's combobox, which is a poor answer to
 * "not this branch" when the branch is on screen and under the pointer.
 *
 * The header opens with one glyph for the **nearest** ancestor — the node the rows below hang
 * directly from — drawn with the same `NodeIcon` the Mindmap and the task rows use, so one
 * vocabulary covers all three. One glyph, not one per segment: the chain is read for where it ends,
 * and a marker beside every step would compete with the titles it exists to qualify. The glyph can
 * be switched off from the settings popover, leaving the chain as bare titles.
 *
 * The chain closes with a **`+`** that creates a Task under its last node — the one the rows below
 * hang from, so where the new row lands is exactly what the header already says. It is the way in
 * with nothing selected, which the two creation chords cannot cover because both read their parent
 * off the selection. */
export default function PathHeaderRow({ segments, onEnterSubtree, onFilterByAntecedent, showKindIcon, onCreateTask }: Props) {
  const { t } = useTranslation("listView");
  const parent = segments[segments.length - 1];

  function handleSegmentClick(event: MouseEvent, id: string) {
    const side = filterSideFor(event);
    if (side === null) {
      onEnterSubtree(id);
      return;
    }
    // A modifier click narrows in place and does *nothing else*: it must not also re-root, and it
    // must not read as a click on the list beneath the header. No ancestor of this button listens
    // for clicks today, so stopping the event here is what keeps that a fact about the list rather
    // than something this gesture quietly depends on.
    event.preventDefault();
    event.stopPropagation();
    onFilterByAntecedent(id, side);
  }

  return (
    <div className={styles.header}>
      {/* An Aspect carries no glyph anywhere in the app — `NodeIcon` returns null for one — so the
          wrapper is skipped rather than reserving an empty box before the chain. */}
      {showKindIcon && parent !== undefined && parent.kind !== "aspect" && (
        <svg
          className={styles.icon}
          width={ICON_R * 2}
          height={ICON_R * 2}
          viewBox={`0 0 ${ICON_R * 2} ${ICON_R * 2}`}
          aria-hidden="true"
        >
          <NodeIcon
            kind={parent.kind}
            status={parent.status}
            verdict={parent.verdict}
            isArchived={parent.archived === true}
            isBlocked={isNodeBlocked(parent)}
            isHabit={parent.flow?.isHabit === true}
            cx={ICON_R}
            cy={ICON_R}
            r={ICON_R * 0.9}
            color="currentColor"
            opacity={1}
          />
        </svg>
      )}
      {segments.map((segment, index) => (
        <Fragment key={segment.id}>
          {index > 0 && <span className={styles.separator} aria-hidden="true" />}
          <button
            type="button"
            className={styles.segment}
            dir="auto"
            title={t("pathSegmentActions")}
            onClick={(event) => handleSegmentClick(event, segment.id)}
          >
            {segment.title}
          </button>
        </Fragment>
      ))}
      {onCreateTask !== null && (
        <button
          type="button"
          className={styles.create}
          title={t("createTaskHere")}
          aria-label={t("createTaskHere")}
          onClick={onCreateTask}
        >
          <svg width={PLUS_SIZE} height={PLUS_SIZE} viewBox="0 0 10 10" aria-hidden="true">
            <path d="M5 1.5v7M1.5 5h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
