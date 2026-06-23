import { useCallback, useEffect, useState } from "react";
import { listDomains, createDomain, updateDomain, deleteDomain } from "@/api/domains";
import { listTasks, createTask, updateTask, deleteTask } from "@/api/tasks";
import { listGoals, createGoal, updateGoal, deleteGoal } from "@/api/goals";
import type { Domain } from "@/api/domains";
import type { Task } from "@/api/tasks";
import type { Goal } from "@/api/goals";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { goalStatusToTaskStatus, taskStatusToGoalStatus } from "@/utils/status-mapping";

export type GoalChildrenAction = "remove" | "reparent";

export interface RetypeOptions {
  goalChildrenAction?: GoalChildrenAction;
}

interface MindmapData {
  tree: MindmapNode;
  isLoading: boolean;
  error: string | null;
  createChild: (parentId: string, parentKind: NodeKind, title: string) => Promise<MindmapNode>;
  renameNode: (id: string, kind: NodeKind, title: string) => Promise<void>;
  retypeNode: (id: string, fromKind: NodeKind, toKind: NodeKind, options?: RetypeOptions) => Promise<string | null>;
  reorderNode: (id: string, direction: 1 | -1) => Promise<void>;
  moveNode: (id: string, kind: NodeKind, newParentId: string, newParentKind: NodeKind) => Promise<void>;
  removeNode: (id: string, kind: NodeKind) => Promise<void>;
  reload: () => Promise<void>;
}

const VIRTUAL_ROOT: MindmapNode = {
  id: "root",
  kind: "domain",
  title: "Arlesh",
  position: 0,
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

function findNodeInTree(root: MindmapNode, id: string): MindmapNode | undefined {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findNodeInTree(child, id);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findParentInTree(root: MindmapNode, id: string): MindmapNode | undefined {
  for (const child of root.children) {
    if (child.id === id) return root;
    const found = findParentInTree(child, id);
    if (found !== undefined) return found;
  }
  return undefined;
}

function subtypeToKind(subtype: string): NodeKind {
  switch (subtype) {
    case "aspect": return "aspect";
    case "project": return "project";
    case "tag": return "tag";
    default: return "domain";
  }
}

function propagateAspectColor(node: MindmapNode, inheritedColor: string | undefined): void {
  const colorToPropagate = node.kind === "aspect" ? node.color : inheritedColor;
  if (node.kind !== "aspect" && colorToPropagate !== undefined && node.color === undefined) {
    node.color = colorToPropagate;
  }
  for (const child of node.children) {
    propagateAspectColor(child, colorToPropagate);
  }
}

function buildTree(domains: Domain[], goals: Goal[], tasks: Task[]): MindmapNode {
  const nodeMap = new Map<string, MindmapNode>();

  for (const domain of domains) {
    nodeMap.set(`domain-${domain.id}`, {
      id: `domain-${domain.id}`,
      kind: subtypeToKind(domain.subtype),
      title: domain.title,
      position: domain.position,
      ...(domain.color !== null ? { color: domain.color } : {}),
      ...(domain.status !== null ? { status: domain.status } : {}),
      ...(domain.knowledge_base_directory !== null ? { knowledgeBaseDirectory: domain.knowledge_base_directory } : {}),
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
      blockedReason: goal.blocked_reason,
      position: goal.position,
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
      blockedReason: task.blocked_reason,
      position: task.position,
      tagIds: task.tag_ids,
      children: [],
    });
  }

  // Wire domain tree (all subtypes including tags)
  for (const domain of domains) {
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

  // Sort each parent's children by position so mixed-type siblings
  // (e.g. goals and tasks under the same project) respect insertion order
  // rather than being grouped by entity type.
  for (const node of nodeMap.values()) {
    node.children.sort((a, b) => a.position - b.position);
  }

  const aspectNodes = domains
    .filter((d) => d.subtype === "aspect")
    .map((d) => nodeMap.get(`domain-${d.id}`)!)
    .filter((n) => n !== undefined)
    .sort((a, b) => a.position - b.position);

  const root = { ...VIRTUAL_ROOT, children: aspectNodes };
  propagateAspectColor(root, undefined);
  return root;
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

  // Refreshes the tree in-place without the loading spinner — used for mutations
  // so the canvas stays mounted and pan/zoom state is preserved.
  const silentLoad = useCallback(async () => {
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
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const createChild = useCallback(
    async (parentId: string, parentKind: NodeKind, title: string): Promise<MindmapNode> => {
      const dbParentId = dbIdFromNodeId(parentId);

      // Domain-table nodes: aspect creates a domain child; domain/project creates same-type child.
      if (parentKind === "aspect" || parentKind === "domain" || parentKind === "project") {
        const subtype = parentKind === "project" ? "project" : "domain";
        const domain = await createDomain({
          title,
          description: null,
          subtype,
          parent_id: dbParentId,
          status: null,
          knowledge_base_directory: null,
        });
        const newNode: MindmapNode = {
          id: `domain-${domain.id}`,
          kind: parentKind === "project" ? "project" : "domain",
          title: domain.title,
          position: domain.position,
          tagIds: [],
          children: [],
        };
        await silentLoad();
        return newNode;
      }

      if (parentKind === "goal") {
        const goal = await createGoal({ title, parent_type: "goal", parent_id: dbParentId });
        const newNode: MindmapNode = {
          id: `goal-${goal.id}`,
          kind: "goal",
          title: goal.title,
          status: goal.status,
          position: goal.position,
          tagIds: [],
          children: [],
        };
        await silentLoad();
        return newNode;
      }

      // task → task subtask
      const task = await createTask({ title, parent_type: "task", parent_id: dbParentId });
      const newNode: MindmapNode = {
        id: `task-${task.id}`,
        kind: "task",
        title: task.title,
        status: task.status,
        position: task.position,
        tagIds: [],
        children: [],
      };
      await silentLoad();
      return newNode;
    },
    [silentLoad],
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
      await silentLoad();
    },
    [silentLoad],
  );

  const retypeNode = useCallback(
    async (id: string, fromKind: NodeKind, toKind: NodeKind, options?: RetypeOptions): Promise<string | null> => {
      const dbId = dbIdFromNodeId(id);
      const domainTableKinds = new Set<NodeKind>(["domain", "project", "tag"]);

      // Same-table conversion: node ID is unchanged.
      if (domainTableKinds.has(fromKind) && domainTableKinds.has(toKind)) {
        await updateDomain(dbId, { subtype: toKind });
        await silentLoad();
        return null;
      }

      // Cross-table conversions: create new entity, re-parent compatible children, delete old.
      const node = findNodeInTree(tree, id);
      const parent = findParentInTree(tree, id);
      const title = node?.title ?? "";
      const children = node?.children ?? [];
      const oldPosition = node?.position;
      const parentDbId = parent !== undefined && parent.id !== "root"
        ? dbIdFromNodeId(parent.id)
        : null;

      if (domainTableKinds.has(fromKind) && (toKind === "goal" || toKind === "task")) {
        if (parentDbId === null) return null; // aspects can't convert to goal/task
        const parentType = kindToParentType(parent!.kind);

        if (toKind === "goal") {
          const newGoal = await createGoal({ title, parent_type: parentType, parent_id: parentDbId });
          if (oldPosition !== undefined) await updateGoal(newGoal.id, { position: oldPosition });
          for (const child of children) {
            const childDbId = dbIdFromNodeId(child.id);
            if (child.kind === "goal") {
              await updateGoal(childDbId, { parent_type: "goal", parent_id: newGoal.id });
            } else if (child.kind === "task") {
              await updateTask(childDbId, { parent_type: "goal", parent_id: newGoal.id });
            } else {
              console.warn(`[arlesh] retypeNode: ${child.kind} child "${child.title}" orphaned`);
            }
          }
          await deleteDomain(dbId);
          await silentLoad();
          return `goal-${newGoal.id}`;
        } else {
          const newTask = await createTask({ title, parent_type: parentType, parent_id: parentDbId });
          if (oldPosition !== undefined) await updateTask(newTask.id, { position: oldPosition });
          for (const child of children) {
            const childDbId = dbIdFromNodeId(child.id);
            if (child.kind === "task") {
              await updateTask(childDbId, { parent_type: "task", parent_id: newTask.id });
            } else {
              console.warn(`[arlesh] retypeNode: ${child.kind} child "${child.title}" orphaned`);
            }
          }
          await deleteDomain(dbId);
          await silentLoad();
          return `task-${newTask.id}`;
        }
      }

      if ((fromKind === "goal" || fromKind === "task") && domainTableKinds.has(toKind)) {
        if (parentDbId === null) return null;
        const newDomain = await createDomain({
          title, subtype: toKind, parent_id: parentDbId,
          description: null, status: null, knowledge_base_directory: null,
        });
        if (oldPosition !== undefined) await updateDomain(newDomain.id, { position: oldPosition });
        for (const child of children) {
          const childDbId = dbIdFromNodeId(child.id);
          if (child.kind === "goal") {
            await updateGoal(childDbId, { parent_type: "project", parent_id: newDomain.id });
          } else if (child.kind === "task") {
            await updateTask(childDbId, { parent_type: "project", parent_id: newDomain.id });
          }
        }
        if (fromKind === "goal") await deleteGoal(dbId);
        else await deleteTask(dbId);
        await silentLoad();
        return `domain-${newDomain.id}`;
      }

      // goal↔task cross-table conversion with status mapping.
      if (fromKind === "goal" && toKind === "task") {
        if (parentDbId === null) return null;
        const parentType = kindToParentType(parent!.kind);
        const mappedStatus = goalStatusToTaskStatus(node?.status ?? "active");
        const newTask = await createTask({ title, parent_type: parentType, parent_id: parentDbId, status: mappedStatus });
        const blockedReason = node?.blockedReason;
        await updateTask(newTask.id, {
          ...(oldPosition !== undefined ? { position: oldPosition } : {}),
          ...(blockedReason != null && blockedReason !== "" ? { blocked_reason: blockedReason } : {}),
        });
        for (const child of children) {
          const childDbId = dbIdFromNodeId(child.id);
          if (child.kind === "task") {
            await updateTask(childDbId, { parent_type: "task", parent_id: newTask.id });
          } else if (child.kind === "goal") {
            if (options?.goalChildrenAction === "reparent") {
              await updateGoal(childDbId, { parent_type: parentType, parent_id: parentDbId });
            } else {
              await deleteGoal(childDbId);
            }
          }
        }
        await deleteGoal(dbId);
        await silentLoad();
        return `task-${newTask.id}`;
      }

      if (fromKind === "task" && toKind === "goal") {
        if (parentDbId === null) return null;
        const parentType = kindToParentType(parent!.kind);
        const mappedStatus = taskStatusToGoalStatus(node?.status ?? "todo");
        const newGoal = await createGoal({ title, parent_type: parentType, parent_id: parentDbId, status: mappedStatus });
        const blockedReason = node?.blockedReason;
        await updateGoal(newGoal.id, {
          ...(oldPosition !== undefined ? { position: oldPosition } : {}),
          ...(blockedReason != null && blockedReason !== "" ? { blocked_reason: blockedReason } : {}),
        });
        for (const child of children) {
          const childDbId = dbIdFromNodeId(child.id);
          if (child.kind === "task") {
            await updateTask(childDbId, { parent_type: "goal", parent_id: newGoal.id });
          } else if (child.kind === "goal") {
            await updateGoal(childDbId, { parent_type: parentType, parent_id: parentDbId });
          }
        }
        await deleteTask(dbId);
        await silentLoad();
        return `goal-${newGoal.id}`;
      }

      return null;
    },
    [silentLoad, tree],
  );

  const reorderNode = useCallback(
    async (id: string, direction: 1 | -1): Promise<void> => {
      const parent = findParentInTree(tree, id);
      if (parent === undefined) return;

      const siblings = parent.children;
      const idx = siblings.findIndex((s) => s.id === id);
      if (idx === -1) return;

      const neighborIdx = idx + direction;
      if (neighborIdx < 0 || neighborIdx >= siblings.length) return;

      const node = siblings[idx]!;
      const neighbor = siblings[neighborIdx]!;
      const nodeDbId = dbIdFromNodeId(id);
      const neighborDbId = dbIdFromNodeId(neighbor.id);
      const nodePos = node.position;
      const neighborPos = neighbor.position;

      // Swap positions, dispatching to the correct table for each node.
      const setPos = async (nId: number, kind: NodeKind, pos: number): Promise<void> => {
        if (kind === "goal") await updateGoal(nId, { position: pos });
        else if (kind === "task") await updateTask(nId, { position: pos });
        else await updateDomain(nId, { position: pos });
      };

      await Promise.all([
        setPos(nodeDbId, node.kind, neighborPos),
        setPos(neighborDbId, neighbor.kind, nodePos),
      ]);
      await silentLoad();
    },
    [silentLoad, tree],
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
      await silentLoad();
    },
    [silentLoad],
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
      await silentLoad();
    },
    [silentLoad],
  );

  return {
    tree,
    isLoading,
    error,
    createChild,
    renameNode,
    retypeNode,
    reorderNode,
    moveNode,
    removeNode,
    reload: silentLoad,
  };
}
