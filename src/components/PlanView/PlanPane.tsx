import { Fragment, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { PillSide, TaskListRow } from "@/utils/list-filter";
import type { PlanPane as PlanPaneSide } from "@/utils/hotkeys/plan/selection";
import type { PaneModel } from "@/utils/plan-pane-model";
import type { PlanSection } from "@/utils/plan-sections";
import type { SubscopeKeys } from "@/utils/plan-subscope-keys";
import { isPlanDrag } from "@/utils/plan-drag";
import PathHeaderRow from "@/components/ListView/PathHeaderRow";
import PaneMenu from "./PaneMenu";
import type { PaneOption } from "./PaneMenu";
import PlanTaskCard from "./PlanTaskCard";
import type { SelectModifiers } from "./PlanTaskCard";
import styles from "./PlanView.module.css";

/** How a bucket reads and how the keyboard reaches it — the view resolves both and hands them in. */
export interface SectionInfo {
  label: string;
  keys: SubscopeKeys;
}

interface Props {
  which: PlanPaneSide;
  heading: string;
  options: readonly PaneOption[];
  model: PaneModel;
  focused: boolean;
  /** Whether runs are headed by their path, which is also what takes the path off the cards. */
  grouped: boolean;
  /** What the frame is called — the board's root, or the subtree the tab has entered. */
  rootLabel: string;
  pathHeaderIcons: boolean;
  selectedIds: ReadonlySet<string>;
  /** Which way a card in this pane moves, or `null` where no across-move is offered. */
  direction: "in" | "out" | null;
  empty: ReactNode;
  sectionInfo: ReadonlyMap<string, SectionInfo>;
  onFocus: () => void;
  onSelect: (id: string, modifiers: SelectModifiers) => void;
  onMove: (row: TaskListRow) => void;
  onOpenEditor: (id: string) => void;
  onEnterSubtree: (id: string) => void;
  onFilterByAntecedent: (id: string, side: PillSide) => void;
  onDragStart: (event: DragEvent<HTMLElement>, nodeId: string) => void;
  /** A drop landed on this pane, in `section` — `null` for the pane at large. */
  onDrop: (event: DragEvent<HTMLElement>, section: PlanSection | null) => void;
}

/** Lets a drag settle here, and says it is a move rather than a copy. */
function acceptDrag(event: DragEvent<HTMLElement>): boolean {
  if (!isPlanDrag(event.dataTransfer)) return false;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  return true;
}

/** Which target the pointer is over while a drag is in flight — the pane at large, or one bucket. */
const WHOLE_PANE = "pane";

/**
 * One half of the triage: a heading, the menu of options for this half, and the rows.
 *
 * **Nothing the pane draws above a card is landable.** Bucket headings and path headers are entries
 * in the same stream the cards are in, so `Down` steps from the last card of one bucket to the
 * first card of the next — which is also why a bucket is a box for the *pointer* (it has to be
 * droppable) and not for the keyboard.
 */
export default function PlanPane({
  which, heading, options, model, focused, grouped, rootLabel, pathHeaderIcons, selectedIds,
  direction, empty, sectionInfo, onFocus, onSelect, onMove, onOpenEditor, onEnterSubtree,
  onFilterByAntecedent, onDragStart, onDrop,
}: Props) {
  const { t } = useTranslation("planView");
  // A drop target that does not light up is one you have to aim at twice. `dragover` fires
  // continuously over the same element, so the write is guarded on the value actually changing.
  const [over, setOver] = useState<string | null>(null);

  function hover(event: DragEvent<HTMLElement>, key: string): void {
    if (!acceptDrag(event)) return;
    setOver((current) => (current === key ? current : key));
  }

  // With the split on, an empty pane still has buckets to show: an empty week is the answer to
  // "what is in this month" just as much as a full one.
  const showEmpty = model.rows.length === 0 && !model.sectioned;

  function sectionHeading(section: PlanSection): ReactNode {
    const info = sectionInfo.get(section.key);
    const keys: string[] = [];
    if (info?.keys.letter != null) keys.push(info.keys.letter);
    if (info?.keys.digit != null) keys.push(String(info.keys.digit));
    return (
      <h3 className={styles.sectionHeading}>
        <span className={styles.sectionName}>{info?.label ?? ""}</span>
        {/* A month's first and last weeks usually poke outside it. They are drawn and said to be
            partial, with their dates, rather than dropped — a bucket left out would hide whatever
            is planned into it from this scope's view entirely. */}
        {section.partial && (
          <span className={styles.sectionPartial}>
            {t("subscopePartial", { start: section.range.startDate, end: section.range.endDate })}
          </span>
        )}
        {keys.length > 0 && (
          <span
            className={styles.sectionKeys}
            title={t("subscopeKeyHint", { scope: info?.label ?? "", keys: keys.join(" / ") })}
          >
            {keys.map((key) => <kbd key={key} className={styles.key}>{key}</kbd>)}
          </span>
        )}
      </h3>
    );
  }

  function cards(): ReactNode {
    return model.blocks.map((block) => {
      const body = (
        <Fragment key={block.key}>
          {block.section !== null && sectionHeading(block.section)}
          {block.section !== null && block.entries.length === 0 && (
            <p className={styles.sectionEmpty}>{t("subscopeEmpty")}</p>
          )}
          {block.entries.map((entry, index) => {
            if (entry.type === "root") {
              return <div key={`root-${block.key}-${String(index)}`} className={styles.rootHeader}>{rootLabel}</div>;
            }
            if (entry.type === "path") {
              return (
                <PathHeaderRow
                  key={`path-${block.key}-${String(index)}-${entry.pathKey}`}
                  segments={entry.segments}
                  onEnterSubtree={onEnterSubtree}
                  onFilterByAntecedent={onFilterByAntecedent}
                  showKindIcon={pathHeaderIcons}
                  // The Plan View writes Plans and nothing else, so it offers no way to create a
                  // Task from a header — absent rather than present and always refusing.
                  onCreateTask={null}
                />
              );
            }
            return (
              <PlanTaskCard
                key={entry.row.node.id}
                row={entry.row}
                isSelected={selectedIds.has(entry.row.node.id)}
                direction={direction}
                showPath={!grouped}
                onSelect={onSelect}
                onMove={onMove}
                onOpenEditor={onOpenEditor}
                onDragStart={onDragStart}
              />
            );
          })}
        </Fragment>
      );
      if (block.section === null) return body;
      const section = block.section;
      return (
        <div
          key={block.key}
          className={`${styles.section}${over === section.key ? ` ${styles.sectionOver}` : ""}`}
          data-plan-section={section.key}
          onDragOver={(event) => hover(event, section.key)}
          onDragLeave={() => setOver(null)}
          onDrop={(event) => { event.stopPropagation(); setOver(null); onDrop(event, section); }}
        >
          {body}
        </div>
      );
    });
  }

  return (
    <section
      className={`${styles.pane}${focused ? ` ${styles.paneFocused}` : ""}${over === WHOLE_PANE ? ` ${styles.paneOver}` : ""}`}
      aria-label={heading}
      data-plan-pane={which}
      onClick={onFocus}
      // With the pane split, the buckets are the only drop targets: dropping on the pane at large
      // would be planning into the scope itself, which is exactly the move the split replaces. The
      // pointer says so on its own — over the gaps there is simply nothing that accepts the drag.
      onDragOver={model.sectioned ? undefined : (event) => hover(event, WHOLE_PANE)}
      onDragLeave={model.sectioned ? undefined : () => setOver(null)}
      onDrop={model.sectioned ? undefined : (event) => { setOver(null); onDrop(event, null); }}
    >
      <div className={styles.paneBar}>
        <h2 className={styles.paneHeading}>{heading}</h2>
        <PaneMenu label={t("paneOptions", { pane: heading })} options={options} />
      </div>
      {showEmpty ? empty : <div className={styles.cards}>{cards()}</div>}
    </section>
  );
}
