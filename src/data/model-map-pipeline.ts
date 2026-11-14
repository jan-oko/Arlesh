/**
 * The words in the pipeline diagram at the top of the map: stored rows, the board load, the filters
 * and their readers. The boxes and arrows are drawn by `PipelineDiagram`; only its text is data,
 * so editing a label is a one-line change here. Coordinates are in the diagram's 980 x 430 space.
 */

/** Which colour a label takes: a band of the map, or the default and the muted tone. */
export type PipelineTone = "text" | "muted" | "stored" | "derived" | "read";

/** One label. */
export interface PipelineText {
  x: number;
  y: number;
  text: string;
  tone?: PipelineTone;
  anchor?: "start" | "middle";
  bold?: boolean;
  /** Font size; the diagram's default is 13. */
  size?: number;
}

export const PIPELINE_VIEWBOX = { width: 980, height: 430 } as const;

/** The diagram's accessible description. */
export const PIPELINE_DESCRIPTION =
  "Pipeline: stored rows in SQLite are read on every board load, which derives occurrences, lifecycles, statuses and blocks without storing them; the filters read the derived board; the views and the MCP read the filtered board; edits from either go back only into stored rows and overlays, and SQL triggers journal every write for undo.";

export const PIPELINE_TEXTS: readonly PipelineText[] = [
  { x: 110, y: 28, text: "Stored · SQLite", tone: "stored", anchor: "middle", bold: true },
  { x: 26, y: 70, text: "Node rows by kind" },
  { x: 26, y: 94, text: "Parent tree" },
  { x: 26, y: 118, text: "Flow & Habit templates" },
  { x: 26, y: 142, text: "Overlays (edits to" },
  { x: 26, y: 160, text: "derived rows)" },
  { x: 26, y: 184, text: "Dependencies, reasons" },
  { x: 26, y: 208, text: "Statuses, done instants" },
  { x: 26, y: 232, text: "Time Scope, Plan, due" },
  { x: 26, y: 256, text: "scope keys, never", tone: "muted" },
  { x: 26, y: 274, text: "scope rows", tone: "muted" },

  { x: 395, y: 28, text: "Board load · derived, never stored", tone: "derived", anchor: "middle", bold: true },
  { x: 298, y: 74, text: "Scope lifecycles: Timing, Overdue" },
  { x: 298, y: 112, text: "Habit occurrences, cooldown" },
  { x: 298, y: 150, text: "Waits and check tasks" },
  { x: 298, y: 188, text: "Compound and parent status, Review" },
  { x: 298, y: 226, text: "Blocks: reasons, deps, capacity" },
  { x: 298, y: 262, text: "in this order, every load", tone: "muted" },

  { x: 660, y: 83, text: "Filters", tone: "read", anchor: "middle", bold: true },
  { x: 596, y: 124, text: "Presets: Plan," },
  { x: 596, y: 144, text: "Start, Do, Backlog" },
  { x: 596, y: 168, text: "Pills: Any / All / Not" },
  { x: 596, y: 192, text: "Rust and TS twins,", tone: "muted" },
  { x: 596, y: 210, text: "one shared corpus", tone: "muted" },

  { x: 885, y: 66, text: "Views", anchor: "middle", bold: true },
  { x: 816, y: 92, text: "Mindmap · List" },
  { x: 816, y: 112, text: "Plan · Steps · Zen" },
  { x: 816, y: 134, text: "you", tone: "muted" },
  { x: 885, y: 206, text: "MCP", anchor: "middle", bold: true },
  { x: 816, y: 232, text: "roots · private" },
  { x: 816, y: 252, text: "writes Agentic only" },
  { x: 816, y: 274, text: "agents", tone: "muted" },

  { x: 239, y: 155, text: "read", tone: "muted", anchor: "middle", size: 12 },
  { x: 549, y: 155, text: "facts", tone: "muted", anchor: "middle", size: 12 },
  { x: 497, y: 342, text: "edits write stored rows and overlays only, never a derived value", tone: "stored", anchor: "middle", size: 12 },

  { x: 110, y: 403, text: "undo journal", anchor: "middle" },
  { x: 236, y: 403, text: "SQL triggers record every row write; Ctrl+Z replays it backwards", tone: "muted", size: 12 },
];
