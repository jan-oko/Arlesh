import { useEffect, useRef, useState } from "react";
import { storedId } from "@/api/node-id";
import { useTranslation } from "react-i18next";
import { rowIdOf } from "@/utils/node-identity";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { entityNodeId } from "@/utils/tree-layout";
import { dayScopeDate } from "@/utils/scope-calendar";
import { getErrorMessage } from "@/api/errors";
import EditorModal from "@/components/EditorModal/EditorModal";
import { useValidFlowTargets } from "@/hooks/use-valid-flow-targets";
import { useInputCapture } from "@/hooks/use-input-capture";
import styles from "@/components/EditorModal/EditorModal.module.css";

export interface StartFlowData {
  title: string;
  targetType: string;
  targetId: number;
  anchorDate: string;
}

const NODE_KINDS: NodeKind[] = ["aspect", "project", "domain", "goal", "task", "tag", "info", "flow", "flow_goal", "flow_task"];
function isNodeKind(value: string): value is NodeKind {
  return NODE_KINDS.some((kind) => kind === value);
}

interface TargetSelection { kind: NodeKind; id: number; title: string; }

function initialTarget(defaultTargetType: string | null, defaultTargetId: number | null, candidates: MindmapNode[]): TargetSelection | null {
  if (defaultTargetType === null || defaultTargetId === null) return null;
  const lookupId = entityNodeId(defaultTargetType, defaultTargetId);
  const match = candidates.find((c) => c.id === lookupId);
  const kind = match?.kind ?? (isNodeKind(defaultTargetType) ? defaultTargetType : null);
  if (kind === null) return null;
  return { kind, id: defaultTargetId, title: match?.title ?? `#${defaultTargetId}` };
}

/** The local wall-clock Day scope's date — before 02:00 that is still yesterday's Day. */
function todayIso(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return dayScopeDate(`${d.getFullYear()}-${month}-${day}`, d.getHours());
}

interface Props {
  flowTitle: string;
  flowScoped: boolean;
  durationN: number | null;
  durationKind: string | null;
  defaultTargetType: string | null;
  defaultTargetId: number | null;
  availableTargets: MindmapNode[];
  onStart: (data: StartFlowData) => Promise<void>;
  onClose: () => void;
}

/**
 * Starts a flow: names the materialized root, picks the target node it's created under, and (for a
 * scoped flow) the anchor date whose flow-kind scope becomes the window's first period.
 */
export default function StartFlowModal({ flowTitle, flowScoped, durationN, durationKind, defaultTargetType, defaultTargetId, availableTargets, onStart, onClose }: Props) {
  useInputCapture();
  const { t } = useTranslation(["editor", "nodeKinds"]);
  const [title, setTitle] = useState(flowTitle);
  const [target, setTarget] = useState<TargetSelection | null>(initialTarget(defaultTargetType, defaultTargetId, availableTargets));
  const [targetSearch, setTargetSearch] = useState("");
  const [anchorDate, setAnchorDate] = useState(todayIso());
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // Only targets whose scope contains the concrete flow window (anchor + duration) are offered.
  const validIds = useValidFlowTargets(availableTargets, flowScoped, durationN, durationKind, anchorDate);
  const targetInvalid = target !== null && validIds !== null && !validIds.has(entityNodeId(target.kind, target.id));

  useEffect(() => { titleRef.current?.focus(); titleRef.current?.select(); }, []);

  function selectTarget(candidate: MindmapNode) {
    const id = storedId(rowIdOf(candidate));
    setTarget({ kind: candidate.kind, id, title: candidate.title });
    setTargetSearch("");
  }

  async function handleSave() {
    if (title.trim() === "" || target === null || targetInvalid) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      await onStart({ title: title.trim(), targetType: target.kind, targetId: target.id, anchorDate });
    } catch (err) {
      setSaveError(getErrorMessage(err));
      setIsSaving(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey && event.target === titleRef.current) { event.preventDefault(); void handleSave(); }
    if (event.key === "Escape") onClose();
  }

  const searchLower = targetSearch.trim().toLowerCase();
  const searchResults = searchLower === "" ? [] : availableTargets
    .filter((n) => n.title.toLowerCase().includes(searchLower))
    .filter((n) => validIds === null || validIds.has(n.id))
    .filter((n) => !(target !== null && n.id === `${target.kind}-${target.id}`))
    .slice(0, 8);

  return (
    <EditorModal heading={t("startFlowHeading")} onClose={onClose} onKeyDown={handleKeyDown} isSaving={isSaving} onSave={() => void handleSave()} saveError={saveError}>
      <label className={styles.label}>
        {t("fieldTitle")}
        <input ref={titleRef} className={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} type="text" />
      </label>
      <div className={styles.label}>
        {t("fieldTarget")}
        {/* Exactly one target: once chosen, show it as a chip and hide the search until removed. */}
        {target !== null ? (
          <>
            <div className={styles.depList}>
              <div className={styles.depItem}>
                <span>{target.title}<span className={styles.depKind}>{t(`nodeKinds:${target.kind}`)}</span></span>
                <button type="button" className={styles.depRemoveBtn} onClick={() => setTarget(null)}>×</button>
              </div>
            </div>
            {targetInvalid && <p className={styles.errorMsg}>{t("targetOutOfScope")}</p>}
          </>
        ) : (
          <div className={styles.depSearchWrap}>
            <input type="text" className={styles.depSearch} placeholder={t("placeholderTargetSearch")} value={targetSearch} onChange={(e) => setTargetSearch(e.target.value)} />
            {searchResults.length > 0 && (
              <div className={styles.depResults}>
                {searchResults.map((n) => (
                  <div key={n.id} className={styles.depResult} onMouseDown={(e) => { e.preventDefault(); selectTarget(n); }}>
                    <span>{n.title}</span>
                    <span className={styles.depKind}>{t(`nodeKinds:${n.kind}`)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {flowScoped && (
        <label className={styles.label}>
          {t("fieldAnchor")}
          <input type="date" className={`${styles.control}`} value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} />
        </label>
      )}
    </EditorModal>
  );
}
