import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import type { FlowCyclePair, FlowItemDep } from "@/utils/tree-layout";
import type { FlowItemType } from "@/api/flows";
import EditorModal from "@/components/EditorModal/EditorModal";
import EditorAdvanced from "@/components/EditorModal/EditorAdvanced";
import FlowCycleField from "./FlowCycleField";
import styles from "@/components/EditorModal/EditorModal.module.css";

export interface FlowItemSaveData {
  title: string;
  cycles: FlowCyclePair[];
  addedDeps: FlowItemDep[];
  removedDeps: FlowItemDep[];
  nsfw: boolean;
}

function depKey(dep: FlowItemDep): string { return `${dep.type}-${dep.id}`; }
function depEquals(a: FlowItemDep, b: FlowItemDep): boolean { return a.type === b.type && a.id === b.id; }

function nodeToDep(node: MindmapNode): FlowItemDep | null {
  if (node.flowItem === undefined) return null;
  return { type: node.flowItem.itemType, id: parseInt(node.id.split("-").pop() ?? "0", 10) };
}

interface Props {
  node: MindmapNode;
  availableDeps: MindmapNode[];
  onSave: (data: FlowItemSaveData) => Promise<void>;
  onClose: () => void;
}

/**
 * Edits a flow item (flow-goal / flow-task): its title, block reason, relative
 * cycle pairs, and intra-flow dependencies on other items in the same flow.
 */
export default function FlowItemEditorModal({ node, availableDeps, onSave, onClose }: Props) {
  const { t } = useTranslation(["editor", "nodeKinds"]);
  const itemType: FlowItemType = node.flowItem?.itemType ?? "flow_task";

  const [title, setTitle] = useState(node.title);
  const [cycles, setCycles] = useState<FlowCyclePair[]>(node.flowItem?.cycles ?? []);
  const [currentDeps, setCurrentDeps] = useState<FlowItemDep[]>(node.flowItem?.dependsOn ?? []);
  const [nsfw, setNsfw] = useState(node.nsfw ?? false);
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

  async function handleSave() {
    if (title.trim() === "") return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const addedDeps = currentDeps.filter((d) => !initialDeps.some((id) => depEquals(id, d)));
      const removedDeps = initialDeps.filter((d) => !currentDeps.some((cd) => depEquals(cd, d)));
      await onSave({ title: title.trim(), cycles, addedDeps, removedDeps, nsfw });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      setIsSaving(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey && event.target === titleRef.current) { event.preventDefault(); void handleSave(); }
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
    <EditorModal heading={heading} onClose={onClose} onKeyDown={handleKeyDown} isSaving={isSaving} onSave={() => void handleSave()} saveError={saveError}>
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
      <EditorAdvanced nsfw={nsfw} onNsfwChange={setNsfw} />
    </EditorModal>
  );
}
