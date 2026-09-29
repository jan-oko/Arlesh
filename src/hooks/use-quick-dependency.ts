import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { getErrorMessage } from "@/api/errors";
import { withGesture } from "@/api/gesture";
import { addTaskDependency, listAllTaskDependencies } from "@/api/tasks";
import { useDisplayStore } from "@/stores/use-display-store";
import type { PendingToast } from "@/stores/use-mindmap-store";
import { canHoldDependencies, dependencyCandidates } from "@/utils/dependency-candidates";
import type { DependencyCandidate } from "@/utils/dependency-candidates";
import { collectSearchableNodes, flattenNodesById } from "@/utils/mindmap-tree";
import { rowIdOf } from "@/utils/node-identity";
import type { MindmapNode } from "@/utils/tree-layout";

/** What the open quick dependency picker is adding a prerequisite to. */
export interface QuickDependencyTarget {
  /** The node the picker is drawn at — the selected Task. */
  anchorId: string;
  /** The Task that will depend on the pick. */
  dependent: MindmapNode;
  /** What it may depend on, or `null` while the board's edges are still being read. */
  candidates: DependencyCandidate[] | null;
}

interface Options {
  /** The whole loaded board — the pool the search draws from, as `Ctrl+O`'s does. */
  tree: MindmapNode;
  findNode: (id: string) => MindmapNode | undefined;
  reload: () => Promise<void>;
  showToast: (toast: PendingToast) => void;
}

/** The `D` quick dependency picker: which Task it is open on, and the two ways it ends. */
export interface QuickDependency {
  target: QuickDependencyTarget | null;
  /**
   * Opens the picker on the one selected Task, or refuses out loud: a node that holds no
   * dependencies is named, and a multi-selection is asked to narrow to one.
   */
  open: (ids: readonly string[]) => void;
  /** Makes the Task depend on `candidate`, as one Gesture; a refusal is shown as a toast. */
  apply: (candidate: DependencyCandidate) => Promise<void>;
  /** Closes the picker without writing anything. */
  close: () => void;
}

/**
 * Adds a prerequisite to a Task without opening the editor — bare `D` on the Mindmap, List View
 * and Steps View.
 *
 * The search offers what the editor's Dependencies field offers, less what cannot be picked: the
 * Task itself, what it already depends on, and every Task that already depends on it (a cycle the
 * backend would refuse). Archived nodes follow the node search's setting. The write is the editor's
 * own `add_task_dependency`, so a refusal the search could not foresee still comes back from the
 * backend, and is shown as a toast rather than dropped.
 */
export function useQuickDependency({ tree, findNode, reload, showToast }: Options): QuickDependency {
  const { t } = useTranslation(["warnings", "undo"]);
  const includeArchived = useDisplayStore((s) => s.searchIncludesArchived);
  const [target, setTarget] = useState<QuickDependencyTarget | null>(null);
  // Which opening a late edge read belongs to, so a picker closed and reopened meanwhile is not
  // handed the previous one's candidates.
  const opening = useRef(0);

  const loadCandidates = useCallback(
    (dependent: MindmapNode, anchorId: string) => {
      const ticket = ++opening.current;
      const nodes = collectSearchableNodes(tree, { skipArchived: !includeArchived });
      const byId = flattenNodesById(tree);
      listAllTaskDependencies()
        .then((edges) => {
          if (opening.current !== ticket) return;
          const candidates = dependencyCandidates(dependent, nodes, byId, edges);
          setTarget((current) => (current === null ? null : { ...current, candidates }));
        })
        .catch((error: unknown) => {
          if (opening.current !== ticket) return;
          setTarget(null);
          showToast({ nodeId: anchorId, message: t("warnings:quickDependencyLoadFailed", { message: getErrorMessage(error) }) });
        });
    },
    [tree, includeArchived, showToast, t],
  );

  const open = useCallback(
    (ids: readonly string[]) => {
      const leadId = ids[0];
      const lead = leadId === undefined ? undefined : findNode(leadId);
      if (lead === undefined) return;
      if (ids.length > 1) {
        showToast({ nodeId: lead.id, message: t("warnings:quickDependencyOneAtATime") });
        return;
      }
      if (!canHoldDependencies(lead)) {
        showToast({ nodeId: lead.id, message: t("warnings:quickDependencyNotTask", { title: lead.title }) });
        return;
      }
      setTarget({ anchorId: lead.id, dependent: lead, candidates: null });
      loadCandidates(lead, lead.id);
    },
    [findNode, loadCandidates, showToast, t],
  );

  const close = useCallback(() => {
    opening.current += 1;
    setTarget(null);
  }, []);

  const apply = useCallback(
    async (candidate: DependencyCandidate) => {
      const adding = target;
      close();
      if (adding === null) return;
      try {
        await withGesture(t("undo:gestures.addDependency"), () =>
          addTaskDependency(rowIdOf(adding.dependent), candidate.dependency));
      } catch (error: unknown) {
        const message = t("warnings:quickDependencyFailed", {
          title: adding.dependent.title, prerequisite: candidate.title, message: getErrorMessage(error),
        });
        showToast({ nodeId: adding.anchorId, message });
        return;
      }
      await reload();
    },
    [target, close, reload, showToast, t],
  );

  return { target, open, apply, close };
}
