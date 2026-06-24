import { useCallback, useEffect, useState } from "react";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import type { TaskSaveData } from "@/components/TaskEditorModal/TaskEditorModal";
import type { GoalSaveData } from "@/components/GoalEditorModal/GoalEditorModal";
import type { ProjectSaveData } from "@/components/ProjectEditorModal/ProjectEditorModal";
import type { Domain } from "@/api/domains";
import { listDomains, updateDomain } from "@/api/domains";
import { addTagToTask, removeTagFromTask, updateTask, addTaskDependency, removeTaskDependency } from "@/api/tasks";
import { addTagToGoal, removeTagFromGoal, updateGoal } from "@/api/goals";
import { findNode } from "@/utils/mindmap-tree";
import { DOMAIN_SUBTYPE } from "@/api/domains";

export interface EditorModalState {
  nodeId: string;
  node: MindmapNode;
}

interface Options {
  tree: MindmapNode;
  allTasksAndGoals: MindmapNode[];
  renameNode: (id: string, kind: NodeKind, title: string) => Promise<void>;
  reload: () => Promise<void>;
}

interface Result {
  editorModal: EditorModalState | null;
  setEditorModal: (m: EditorModalState | null) => void;
  allTags: Domain[];
  availableForDep: MindmapNode[];
  onDoubleClick: (nodeId: string) => void;
  onTaskSave: (data: TaskSaveData) => Promise<void>;
  onGoalSave: (data: GoalSaveData) => Promise<void>;
  onSimpleSave: (title: string) => Promise<void>;
  onProjectSave: (data: ProjectSaveData) => Promise<void>;
}

export function useNodeEditor({ tree, allTasksAndGoals, renameNode, reload }: Options): Result {
  const [editorModal, setEditorModal] = useState<EditorModalState | null>(null);
  const [allTags, setAllTags] = useState<Domain[]>([]);

  useEffect(() => { void listDomains(DOMAIN_SUBTYPE.TAG).then(setAllTags); }, []);

  const availableForDep =
    editorModal !== null ? allTasksAndGoals.filter((n) => n.id !== editorModal.nodeId) : [];

  const onDoubleClick = useCallback(
    (nodeId: string) => {
      const node = findNode(tree, nodeId);
      if (node === undefined || node.kind === "aspect") return;
      setEditorModal({ nodeId, node });
    },
    [tree],
  );

  const onTaskSave = useCallback(
    async (data: TaskSaveData) => {
      if (editorModal === null) return;
      const { nodeId, node } = editorModal;
      const dbId = parseInt(nodeId.split("-").pop() ?? "0", 10);
      await updateTask(dbId, { title: data.title, status: data.status, blocked_reason: data.blockedReason });
      const tagsAdded = data.tagIds.filter((id) => !node.tagIds.includes(id));
      const tagsRemoved = node.tagIds.filter((id) => !data.tagIds.includes(id));
      for (const tagId of tagsAdded) await addTagToTask(dbId, tagId);
      for (const tagId of tagsRemoved) await removeTagFromTask(dbId, tagId);
      for (const dep of data.addedDeps) await addTaskDependency(dbId, dep);
      for (const dep of data.removedDeps) await removeTaskDependency(dbId, dep);
      await reload();
      setEditorModal(null);
    },
    [editorModal, reload],
  );

  const onGoalSave = useCallback(
    async (data: GoalSaveData) => {
      if (editorModal === null) return;
      const { nodeId, node } = editorModal;
      const dbId = parseInt(nodeId.split("-").pop() ?? "0", 10);
      await updateGoal(dbId, { title: data.title, status: data.status, blocked_reason: data.blockedReason });
      const tagsAdded = data.tagIds.filter((id) => !node.tagIds.includes(id));
      const tagsRemoved = node.tagIds.filter((id) => !data.tagIds.includes(id));
      for (const tagId of tagsAdded) await addTagToGoal(dbId, tagId);
      for (const tagId of tagsRemoved) await removeTagFromGoal(dbId, tagId);
      await reload();
      setEditorModal(null);
    },
    [editorModal, reload],
  );

  const onSimpleSave = useCallback(
    async (title: string) => {
      if (editorModal === null) return;
      const { nodeId, node } = editorModal;
      await renameNode(nodeId, node.kind, title);
      setEditorModal(null);
    },
    [editorModal, renameNode],
  );

  const onProjectSave = useCallback(
    async (data: ProjectSaveData) => {
      if (editorModal === null) return;
      const { nodeId } = editorModal;
      const dbId = parseInt(nodeId.split("-").pop() ?? "0", 10);
      await updateDomain(dbId, {
        title: data.title,
        ...(data.status !== "" ? { status: data.status } : {}),
        ...(data.knowledgeBaseDirectory !== "" ? { knowledge_base_directory: data.knowledgeBaseDirectory } : {}),
      });
      await reload();
      setEditorModal(null);
    },
    [editorModal, reload],
  );

  return { editorModal, setEditorModal, allTags, availableForDep, onDoubleClick, onTaskSave, onGoalSave, onSimpleSave, onProjectSave };
}
