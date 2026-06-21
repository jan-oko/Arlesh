import { useCallback, useEffect, useState } from "react";
import { listDomains } from "@/api/domains";
import { listTasks, createTask, updateTask, deleteTask } from "@/api/tasks";
import { listGoals, createGoal, updateGoal, deleteGoal } from "@/api/goals";
import type { Domain } from "@/api/domains";
import type { Task } from "@/api/tasks";
import type { Goal } from "@/api/goals";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";

interface MindmapData {
  tree: MindmapNode;
  isLoading: boolean;
  error: string | null;
  createChild: (parentId: string, parentKind: NodeKind, title: string) => Promise<MindmapNode>;
  renameNode: (id: string, kind: NodeKind, title: string) => Promise<void>;
  retypeNode: (id: string, fromKind: NodeKind, toKind: NodeKind) => Promise<void>;
  moveNode: (id: string, kind: NodeKind, newParentId: string, newParentKind: NodeKind) => Promise<void>;
  removeNode: (id: string, kind: NodeKind) => Promise<void>;
  reload: () => Promise<void>;
}

const VIRTUAL_ROOT: MindmapNode = {
  id: "root",
  kind: "domain",
  title: "Arlesh",
  tagIds: [],
  children: [],
};

function dbIdFromNodeId(nodeId: string): number {
  const parts = nodeId.split("-");
  const id = parseInt(parts[parts.length - 1] ?? "", 10);
  if (Number.isNaN(id)) throw new Error(`Node "${nodeId}" is not backed by a database row`);
  return id;
}

function kindToParentType(kind: NodeKind): string {
  if (kind === "goal") return "goal";
  if (kind === "task") return "task";
  return "project";
}

function buildTree(domains: Domain[], goals: Goal[], tasks: Task[]): MindmapNode {
  const nodeMap = new Map<string, MindmapNode>();

  for (const domain of domains) {
    if (domain.subtype === "tag") continue;
    const kind: NodeKind =
      domain.subtype === "aspect"
        ? "aspect"
        : domain.subtype === "project"
          ? "project"
          : "domain";
    nodeMap.set(`domain-${domain.id}`, {
      id: `domain-${domain.id}`,
      kind,
      title: domain.title,
      ...(domain.color !== null ? { color: domain.color } : {}),
      ...(domain.status !== null ? { status: domain.status } : {}),
      tagIds: [],
      children: [],
    });
  }

  for (const goal of goals) {
    nodeMap.set(`goal-${goal.id}`, {
      id: `goal-${goal.id}`,
      kind: "goal",
      title: goal.title,
      status: goal.status,
      tagIds: goal.tag_ids,
      children: [],
    });
  }

  for (const task of tasks) {
    nodeMap.set(`task-${task.id}`, {
      id: `task-${task.id}`,
      kind: "task",
      title: task.title,
      status: task.status,
      tagIds: task.tag_ids,
      children: [],
    });
  }

  // Wire domain tree
  for (const domain of domains) {
    if (domain.subtype === "tag") continue;
    if (domain.parent_id === null) continue;
    const parentNode = nodeMap.get(`domain-${domain.parent_id}`);
    const selfNode = nodeMap.get(`domain-${domain.id}`);
    if (parentNode !== undefined && selfNode !== undefined) {
      parentNode.children.push(selfNode);
    }
  }

  // Wire goals to their parents
  for (const goal of goals) {
    const goalNode = nodeMap.get(`goal-${goal.id}`);
    if (goalNode === undefined) continue;
    const parentKey =
      goal.parent_type === "goal"
        ? `goal-${goal.parent_id}`
        : `domain-${goal.parent_id}`;
    const parentNode = nodeMap.get(parentKey);
    if (parentNode !== undefined) {
      parentNode.children.push(goalNode);
    }
  }

  // Wire tasks to their parents
  for (const task of tasks) {
    const taskNode = nodeMap.get(`task-${task.id}`);
    if (taskNode === undefined) continue;
    const parentKey =
      task.parent_type === "task"
        ? `task-${task.parent_id}`
        : task.parent_type === "goal"
          ? `goal-${task.parent_id}`
          : `domain-${task.parent_id}`;
    const parentNode = nodeMap.get(parentKey);
    if (parentNode !== undefined) {
      parentNode.children.push(taskNode);
    }
  }

  const aspectNodes = domains
    .filter((d) => d.subtype === "aspect")
    .map((d) => nodeMap.get(`domain-${d.id}`)!)
    .filter((n) => n !== undefined);

  return { ...VIRTUAL_ROOT, children: aspectNodes };
}

export function useMindmapData(): MindmapData {
  const [tree, setTree] = useState<MindmapNode>(VIRTUAL_ROOT);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [domains, goals, tasks] = await Promise.all([
        listDomains(),
        listGoals(),
        listTasks(),
      ]);
      setTree(buildTree(domains, goals, tasks));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const createChild = useCallback(
    async (parentId: string, parentKind: NodeKind, title: string): Promise<MindmapNode> => {
      const dbParentId = dbIdFromNodeId(parentId);
      const parentType = kindToParentType(parentKind);

      // Domains and projects produce a goal; goals/tasks produce a task (subtask).
      const makeGoal = parentKind === "domain" || parentKind === "project";

      if (makeGoal) {
        const goal = await createGoal({ title, parent_type: parentType, parent_id: dbParentId });
        const newNode: MindmapNode = {
          id: `goal-${goal.id}`,
          kind: "goal",
          title: goal.title,
          status: goal.status,
          tagIds: [],
          children: [],
        };
        await load();
        return newNode;
      }

      // parentKind === "task"
      const task = await createTask({ title, parent_type: parentType, parent_id: dbParentId });
      const newNode: MindmapNode = {
        id: `task-${task.id}`,
        kind: "task",
        title: task.title,
        status: task.status,
        tagIds: [],
        children: [],
      };
      await load();
      return newNode;
    },
    [load],
  );

  const renameNode = useCallback(
    async (id: string, kind: NodeKind, title: string): Promise<void> => {
      const dbId = dbIdFromNodeId(id);
      if (kind === "goal") {
        await updateGoal(dbId, { title });
      } else if (kind === "task") {
        await updateTask(dbId, { title });
      } else {
        await import("@/api/domains").then(({ updateDomain }) => updateDomain(dbId, { title }));
      }
      await load();
    },
    [load],
  );

  const retypeNode = useCallback(
    async (id: string, fromKind: NodeKind, toKind: NodeKind): Promise<void> => {
      // Retyping requires deleting the old entity and creating a new one of the target type.
      // For Phase 2, limited to goal↔task conversion which are in the same parent structure.
      void id;
      void fromKind;
      void toKind;
      // TODO: implement full retype when needed — requires backend support
      await load();
    },
    [load],
  );

  const moveNode = useCallback(
    async (id: string, kind: NodeKind, newParentId: string, newParentKind: NodeKind): Promise<void> => {
      const dbId = dbIdFromNodeId(id);
      const dbParentId = dbIdFromNodeId(newParentId);
      const newParentType = kindToParentType(newParentKind);
      if (kind === "goal") {
        await updateGoal(dbId, { parent_type: newParentType, parent_id: dbParentId });
      } else if (kind === "task") {
        await updateTask(dbId, { parent_type: newParentType, parent_id: dbParentId });
      } else {
        await import("@/api/domains").then(({ updateDomain }) =>
          updateDomain(dbId, { parent_id: dbParentId }),
        );
      }
      await load();
    },
    [load],
  );

  const removeNode = useCallback(
    async (id: string, kind: NodeKind): Promise<void> => {
      const dbId = dbIdFromNodeId(id);
      if (kind === "goal") {
        await deleteGoal(dbId);
      } else if (kind === "task") {
        await deleteTask(dbId);
      } else {
        await import("@/api/domains").then(({ deleteDomain }) => deleteDomain(dbId));
      }
      await load();
    },
    [load],
  );

  return {
    tree,
    isLoading,
    error,
    createChild,
    renameNode,
    retypeNode,
    moveNode,
    removeNode,
    reload: load,
  };
}
