import type { ReactNode } from "react";
import TaskIcon from "@/components/NodeIcon/TaskIcon";

/**
 * The touch chrome's one icon set (`docs/spec/touch.md`): outlined 24 x 24 drawings, a 1.8 stroke
 * with round caps and joins, no fills, `currentColor` — the drawing style of `StatusIcons` and
 * `NodeIcon`, so the bar, the palette and the Steps View's staircase read as one family. The one
 * exception is the status action, which *is* the Started Task's glyph, drawn by `TaskIcon` itself.
 */
export type ActionIconName =
  | "child" | "sibling" | "undo" | "redo" | "open" | "filter" | "status" | "plan" | "dependency"
  | "verdict" | "release" | "checkDone" | "edit" | "startFlow" | "archive" | "planInto" | "kind"
  | "backlog" | "more"
  | "viewZen" | "viewList" | "viewPlan" | "viewSteps" | "viewMap";

const STROKE = 1.8;

/** The drawing of each icon, inside a 24 x 24 box. */
const DRAWINGS: Readonly<Record<Exclude<ActionIconName, "status">, ReactNode>> = {
  // A plus with an elbow going down and in: something new under this.
  child: <><path d="M6 4v8a3 3 0 0 0 3 3h3" /><path d="M18 12v6M15 15h6" /></>,
  // A plus beside a bar: something new next to this.
  sibling: <><path d="M4 7h10M4 17h6" /><path d="M18 11v8M14 15h8" /></>,
  undo: <><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></>,
  redo: <><path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></>,
  // An arrow leaving a frame: go to that node.
  open: <><path d="M13 5h6v6M19 5l-8 8" /><path d="M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4" /></>,
  filter: <path d="M4 5h16l-6 7.5V19l-4 2v-8.5z" />,
  plan: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M8 3v4M16 3v4" /></>,
  dependency: <><path d="M4 12h12" /><path d="m12 7 5 5-5 5" /><path d="M20 5v14" /></>,
  verdict: <><path d="M12 4v16M8 20h8M5 7h14" /><path d="m5 7-3 6h6zM19 7l-3 6h6z" /></>,
  release: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 7.5-2" /></>,
  checkDone: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8 12.5 3 3 5-6" /></>,
  edit: <><path d="m4 20 1-4L16 5a2 2 0 0 1 3 3L8 19z" /><path d="m14 7 3 3" /></>,
  startFlow: <path d="M8 5v14l11-7z" />,
  archive: <><rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4" /></>,
  planInto: <><path d="M4 12h11" /><path d="m11 7 5 5-5 5" /><path d="M20 4v16" /></>,
  kind: <><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 13 9 5 9-5" /></>,
  backlog: <circle cx="12" cy="12" r="8" strokeDasharray="3.2 3.2" />,
  // The bottom navigation's five views: a target (Zen), a list, a grid of panes (Plan), a
  // staircase (Steps: one level at a time), and a fork (the Mindmap).
  viewZen: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></>,
  viewList: <><path d="M9 7h11M9 12h11M9 17h11" /><circle cx="4.5" cy="7" r=".6" /><circle cx="4.5" cy="12" r=".6" /><circle cx="4.5" cy="17" r=".6" /></>,
  viewPlan: <><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 12h16M12 4v16" /></>,
  viewSteps: <path d="M3 20h5v-5h5v-5h5V5h3" />,
  viewMap: <><circle cx="5" cy="12" r="2" /><circle cx="19" cy="6" r="2" /><circle cx="19" cy="18" r="2" /><path d="M7 12h2c3 0 3-6 8-6M9 12c3 0 3 6 8 6" /></>,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
};

interface Props {
  name: ActionIconName;
  /** The side in px. */
  size?: number;
}

/** One icon of the set; decoration, since the label beside it says what it is. */
export default function ActionIcon({ name, size = 22 }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-action-icon={name}
    >
      {name === "status" ? (
        // The Started Task's own glyph: begun and paused, the state the status action moves a Task to.
        <TaskIcon cx={12} cy={12} r={9} color="currentColor" opacity={1} status="started" isBlocked={false} />
      ) : (
        DRAWINGS[name]
      )}
    </svg>
  );
}
