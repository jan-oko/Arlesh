import { useCallback, useEffect, useState } from "react";
import { listDomains, createDomain } from "@/api/domains";
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

  const aspectNodes = domains
    .filter((d) => d.subtype === "aspect")
    .map((d) => nodeMap.get(`domain-${d.id}`)!)
    .filter((n) => n !== undefined);

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
          tagIds: [],
          children: [],
        };
        await load();
        return newNode;
      }

      if (parentKind === "goal") {
        const goal = await createGoal({ title, parent_type: "goal", parent_id: dbParentId });
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

      // task → task subtask
      const task = await createTask({ title, parent_type: "task", parent_id: dbParentId });
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
      const dbId = dbIdFromNodeId(id);

      // domain / project / tag all live in the domains table — update subtype only.
      const domainTableKinds = new Set<NodeKind>(["domain", "project", "tag"]);
      if (domainTableKinds.has(fromKind) && domainTableKinds.has(toKind)) {
        await import("@/api/domains").then(({ updateDomain }) =>
          updateDomain(dbId, { subtype: toKind }),
        );
        await load();
        return;
      }

      // goal↔task requires cross-table migration (create + re-parent children + delete).
      // Not implemented in Phase 2 — the type cycling UI is wired but the persisted type
      // won't change until this is completed.
      if (
        (fromKind === "goal" && toKind === "task") ||
        (fromKind === "task" && toKind === "goal")
      ) {
        console.warn("[arlesh] retypeNode: goal↔task conversion not yet implemented");
        return;
      }
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
