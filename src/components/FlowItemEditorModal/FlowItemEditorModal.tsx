import { useEffect, useRef, useState } from "react";
import { storedId } from "@/api/node-id";
import { useTranslation } from "react-i18next";
import { rowIdOf } from "@/utils/node-identity";
import type { MindmapNode } from "@/utils/tree-layout";
import type { FlowCyclePair, FlowItemDep } from "@/utils/tree-layout";
import type { CycleReconcile, FlowItemType, TemplateUpdate } from "@/api/flows";
import { orphanedEditCount } from "@/api/flows";
import type { Domain } from "@/api/domains";
import type { TaskAgentic } from "@/api/tasks";
import { TASK_ARCHIVAL } from "@/api/tasks";
import { storedAgenticState } from "@/utils/agentic";
import { getErrorMessage } from "@/api/errors";
import EditorModal from "@/components/EditorModal/EditorModal";
import EditorAdvanced from "@/components/EditorModal/EditorAdvanced";
import ReconcilePrompt from "@/components/ReconcilePrompt/ReconcilePrompt";
import BlockReasonsField from "@/components/BlockReasonsField/BlockReasonsField";
import TagPicker from "@/components/TagPicker/TagPicker";
import Switch from "@/components/Switch/Switch";
import AgenticField from "@/components/TaskEditorModal/AgenticField";
import DelegateField from "@/components/DelegateField/DelegateField";
import { usePeople } from "@/hooks/use-people";
import type { Delegate } from "@/api/tasks";
import FlowCycleField from "./FlowCycleField";
import { useInputCapture } from "@/hooks/use-input-capture";
import styles from "@/components/EditorModal/EditorModal.module.css";

export interface FlowItemSaveData {
  title: string;
  cycles: FlowCyclePair[];
  addedDeps: FlowItemDep[];
  removedDeps: FlowItemDep[];
  isPrivate: boolean;
  /** The template item's own fields, which every occurrence it draws reads unless that
   * occurrence says otherwise. */
  template: TemplateUpdate;
  /**
   * The answer to a cycle change that would orphan what this Habit's occurrences recorded:
   * `"fork"` (Archive & new) or `"discard"` (Discard & regenerate). Absent on a first save.
   */
  reconcile?: CycleReconcile;
}

function depKey(dep: FlowItemDep): string { return `${dep.type}-${dep.id}`; }
function depEquals(a: FlowItemDep, b: FlowItemDep): boolean { return a.type === b.type && a.id === b.id; }

function nodeToDep(node: MindmapNode): FlowItemDep | null {
  if (node.flowItem === undefined) return null;
  return { type: node.flowItem.itemType, id: storedId(rowIdOf(node)) };
}

interface Props {
  node: MindmapNode;
  availableDeps: MindmapNode[];
  allTags: Domain[];
  domainNames: Map<number, string>;
  onSave: (data: FlowItemSaveData) => Promise<void>;
  onClose: () => void;
}

/**
 * Edits a flow item (flow-goal / flow-task) — the template its occurrences are drawn from: its
 * title, relative cycle pairs and intra-flow dependencies, and the fields of its kind each
 * occurrence reads unless it says otherwise (block reasons, tags; for a task, Backlog,
 * Asynchronous and Agentic).
 */
export default function FlowItemEditorModal({ node, availableDeps, allTags, domainNames, onSave, onClose }: Props) {
  useInputCapture();
  const { t } = useTranslation(["editor", "nodeKinds"]);
  const itemType: FlowItemType = node.flowItem?.itemType ?? "flow_task";

  const [title, setTitle] = useState(node.title);
  const [cycles, setCycles] = useState<FlowCyclePair[]>(node.flowItem?.cycles ?? []);
  const [currentDeps, setCurrentDeps] = useState<FlowItemDep[]>(node.flowItem?.dependsOn ?? []);
  const [isPrivate, setIsPrivate] = useState(node.isPrivate ?? false);
  const template = node.flowItem?.template ?? {};
  const [blockReasons, setBlockReasons] = useState<string[]>(template.block_reasons ?? []);
  const [tagIds, setTagIds] = useState<number[]>(template.tag_ids ?? []);
  const [isBacklogged, setIsBacklogged] = useState(template.archival === TASK_ARCHIVAL.BACKLOG);
  const [isAsynchronous, setIsAsynchronous] = useState(template.asynchronous === true);
  const [agentic, setAgentic] = useState<TaskAgentic>(storedAgenticState(template.agentic ?? null));
  const [delegate, setDelegate] = useState<Delegate | null>(template.delegate_to ?? null);
  const people = usePeople();
  const [orphanedCount, setOrphanedCount] = useState<number | null>(null);
  const [depSearch, setDepSearch] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const initialDeps = node.flowItem?.dependsOn ?? [];

  useEffect(() => { titleRef.current?.focus(); titleRef.current?.select(); }, []);

  function removeDep(dep: FlowItemDep) {
    setCurrentDeps((prev) => prev.filter((d) => !depEquals(d, dep)));
  }

  function addDep(candidate: MindmapNode) {
    const dep = nodeToDep(candidate);
    if (dep === null || currentDeps.some((d) => depEquals(d, dep))) return;
    setCurrentDeps((prev) => [...prev, dep]);
    setDepSearch("");
  }

  function templateUpdate(): TemplateUpdate {
    const shared = { tag_ids: tagIds, block_reasons: blockReasons.filter((reason) => reason.trim() !== "") };
    if (itemType === "flow_goal") return shared;
    return {
      ...shared,
      archival: isBacklogged ? TASK_ARCHIVAL.BACKLOG : TASK_ARCHIVAL.LIVE,
      asynchronous: isAsynchronous,
      agentic,
      // Sent only when it changed, so a save that never touched it cannot overwrite it.
      ...(delegate !== (template.delegate_to ?? null) ? { delegate_to: delegate } : {}),
    };
  }

  async function save(reconcile?: CycleReconcile) {
    if (title.trim() === "") return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const addedDeps = currentDeps.filter((d) => !initialDeps.some((id) => depEquals(id, d)));
      const removedDeps = initialDeps.filter((d) => !currentDeps.some((cd) => depEquals(cd, d)));
      await onSave({
        title: title.trim(), cycles, addedDeps, removedDeps, isPrivate, template: templateUpdate(),
        ...(reconcile !== undefined ? { reconcile } : {}),
      });
    } catch (err) {
      // A cycle change that would orphan what this Habit's occurrences recorded asks the Habit
      // editor's question, and the save — undone whole by its gesture — waits for the answer.
      const orphaned = orphanedEditCount(err);
      if (orphaned !== null) setOrphanedCount(orphaned);
      else setSaveError(getErrorMessage(err));
      setIsSaving(false);
    }
  }

  function handleSave() {
    void save();
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey && event.target === titleRef.current) { event.preventDefault(); handleSave(); }
    if (event.key === "Escape") onClose();
  }

  const depSearchLower = depSearch.trim().toLowerCase();
  const searchResults = depSearchLower === "" ? [] : availableDeps
    .filter((n) => n.title.toLowerCase().includes(depSearchLower))
    .filter((n) => {
      const dep = nodeToDep(n);
      return dep !== null && !currentDeps.some((d) => depEquals(d, dep));
    })
    .slice(0, 8);

  function depTitle(dep: FlowItemDep): string {
    const id = dep.type === "flow_goal" ? `flowgoal-${dep.id}` : `flowtask-${dep.id}`;
    return availableDeps.find((n) => n.id === id)?.title ?? `#${dep.id}`;
  }

  const heading = itemType === "flow_goal" ? t("editGoal") : t("editTask");

  return (
    <EditorModal heading={heading} onClose={onClose} onKeyDown={handleKeyDown} isSaving={isSaving} onSave={handleSave} saveError={saveError}>
      {orphanedCount !== null && (
        <ReconcilePrompt
          message={t("reconcilePromptCycles", { count: orphanedCount })}
          onChoose={(choice) => { setOrphanedCount(null); void save(choice); }}
          onCancel={() => setOrphanedCount(null)}
        />
      )}
      <label className={styles.label}>
        {t("fieldTitle")}
        <input ref={titleRef} className={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} type="text" />
      </label>
      {node.flowItem?.flowScopeKind != null && (
        <div className={styles.label}>
          {t("fieldCycles")}
          <FlowCycleField
            flowScopeN={node.flowItem.flowScopeN}
            flowScopeKind={node.flowItem.flowScopeKind}
            value={cycles}
            onChange={setCycles}
          />
        </div>
      )}
      <div className={styles.depSection}>
        <span className={styles.label}>{t("fieldDependencies")}</span>
        {currentDeps.length > 0 && (
          <div className={styles.depList}>
            {currentDeps.map((dep) => (
              <div key={depKey(dep)} className={styles.depItem}>
                <span>{depTitle(dep)}<span className={styles.depKind}>{t(`nodeKinds:${dep.type}`)}</span></span>
                <button type="button" className={styles.depRemoveBtn} onClick={() => removeDep(dep)}>×</button>
              </div>
            ))}
          </div>
        )}
        <div className={styles.depSearchWrap}>
          <input type="text" className={styles.depSearch} placeholder={t("placeholderDepSearch")} value={depSearch} onChange={(e) => setDepSearch(e.target.value)} />
          {searchResults.length > 0 && (
            <div className={styles.depResults}>
              {searchResults.map((n) => (
                <div key={n.id} className={styles.depResult} onMouseDown={(e) => { e.preventDefault(); addDep(n); }}>
                  <span>{n.title}</span>
                  <span className={styles.depKind}>{t(`nodeKinds:${n.kind}`)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {itemType === "flow_task" && (
        <>
          <div className={styles.label}>
            {t("fieldBacklog")}
            <Switch
              checked={isBacklogged}
              onChange={setIsBacklogged}
              label={isBacklogged ? t("backlogOn") : t("backlogOff")}
            />
          </div>
          <div className={styles.label}>
            {t("fieldAsynchronous")}
            <Switch
              checked={isAsynchronous}
              onChange={setIsAsynchronous}
              label={isAsynchronous ? t("asynchronousOn") : t("asynchronousOff")}
            />
          </div>
        </>
      )}
      {itemType === "flow_task" && <DelegateField value={delegate} people={people} onChange={setDelegate} />}
      <BlockReasonsField reasons={blockReasons} onChange={setBlockReasons} />
      <TagPicker allTags={allTags} domainNames={domainNames} selectedIds={tagIds} onChange={setTagIds} />
      <EditorAdvanced isPrivate={isPrivate} onPrivateChange={setIsPrivate}>
        {itemType === "flow_task" && (
          <AgenticField
            value={agentic}
            inherited={false}
            onChange={setAgentic}
            delegatedToAgent={false}
            offersDelegate={false}
            onToggleDelegate={() => undefined}
          />
        )}
      </EditorAdvanced>
    </EditorModal>
  );
}
