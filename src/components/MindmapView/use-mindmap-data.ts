import { useCallback, useEffect, useState } from "react";
import { listDomains, createDomain, updateDomain, deleteDomain } from "@/api/domains";
import { listTasks, createTask, updateTask, deleteTask } from "@/api/tasks";
import { listGoals, createGoal, updateGoal, deleteGoal } from "@/api/goals";
import { listInfos, createInfo, updateInfo, deleteInfo } from "@/api/infos";
import { listFlows, createFlow, updateFlow, deleteFlow } from "@/api/flows";
import type { Domain } from "@/api/domains";
import type { Task } from "@/api/tasks";
import type { Goal } from "@/api/goals";
import type { Info } from "@/api/infos";
import type { Flow, CreateFlowRequest, UpdateFlowRequest } from "@/api/flows";
import type { MindmapNode, NodeKind } from "@/utils/tree-layout";
import { goalStatusToTaskStatus, taskStatusToGoalStatus } from "@/utils/status-mapping";

export const GOAL_CHILDREN_ACTION = {
  REMOVE: "remove",
  REPARENT: "reparent",
} as const;

export const INFO_CHILDREN_ACTION = {
  REMOVE: "remove",
  REPARENT: "reparent",
} as const;

export type GoalChildrenAction = "remove" | "reparent";
export type InfoChildrenAction = "remove" | "reparent";

export interface RetypeOptions {
  goalChildrenAction?: GoalChildrenAction;
  infoChildrenAction?: InfoChildrenAction;
}

interface MindmapData {
  tree: MindmapNode;
  isLoading: boolean;
  error: string | null;
  createNode: (parentId: string, parentKind: NodeKind, childKind: NodeKind, title: string) => Promise<MindmapNode>;
  createChild: (parentId: string, parentKind: NodeKind, title: string) => Promise<MindmapNode>;
  renameNode: (id: string, kind: NodeKind, title: string) => Promise<void>;
  retypeNode: (id: string, fromKind: NodeKind, toKind: NodeKind, options?: RetypeOptions) => Promise<string | null>;
  reorderNode: (id: string, direction: 1 | -1) => Promise<void>;
  moveNode: (id: string, kind: NodeKind, newParentId: string, newParentKind: NodeKind, position: number) => Promise<void>;
  removeNode: (nodesToDelete: Array<{ id: string; kind: NodeKind }>) => Promise<void>;
  createFlow: (request: CreateFlowRequest) => Promise<Flow>;
  updateFlow: (id: number, request: UpdateFlowRequest) => Promise<void>;
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

function kindToInfoParentType(kind: NodeKind): string {
  switch (kind) {
    case "goal": return "goal";
    case "task": return "task";
    case "info": return "info";
    case "aspect": return "aspect";
    case "project": return "project";
    case "domain": return "domain";
    case "tag": return "tag";
    case "flow": throw new Error("Flow nodes cannot parent info nodes");
  }
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

function infoParentKey(info: Info): string {
  if (info.parent_type === "goal") return `goal-${info.parent_id}`;
  if (info.parent_type === "task") return `task-${info.parent_id}`;
  if (info.parent_type === "info") return `info-${info.parent_id}`;
  return `domain-${info.parent_id}`;
}

export function buildTree(
  domains: Domain[],
  goals: Goal[],
  tasks: Task[],
  infos: Info[],
  flows: Flow[] = [],
): MindmapNode {
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
      timeScope: goal.time_scope,
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
      timeScope: task.time_scope,
      plan: task.plan,
      position: task.position,
      tagIds: task.tag_ids,
      children: [],
    });
  }

  for (const info of infos) {
    nodeMap.set(`info-${info.id}`, {
      id: `info-${info.id}`,
      kind: "info",
      title: info.body,
      position: info.position,
      tagIds: [],
      children: [],
    });
  }

  for (const flow of flows) {
    nodeMap.set(`flow-${flow.id}`, {
      id: `flow-${flow.id}`,
      kind: "flow",
      title: flow.title,
      position: flow.position,
      flow: {
        instanceType: flow.instance_type,
        targetType: flow.target_type,
        targetId: flow.target_id,
        durationN: flow.flow_duration_n,
        durationKind: flow.flow_duration_kind,
      },
      tagIds: [],
      children: [],
    });
  }

  // Wire flows to their parents (flow items are wired in 7.3)
  for (const flow of flows) {
    const flowNode = nodeMap.get(`flow-${flow.id}`);
    if (flowNode === undefined) continue;
    const parentKey =
      flow.parent_type === "goal" ? `goal-${flow.parent_id}` : `domain-${flow.parent_id}`;
    const parentNode = nodeMap.get(parentKey);
    if (parentNode !== undefined) {
      parentNode.children.push(flowNode);
    }
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

  // Wire info nodes to their parents
  for (const info of infos) {
    const infoNode = nodeMap.get(`info-${info.id}`);
    if (infoNode === undefined) continue;
    const parentNode = nodeMap.get(infoParentKey(info));
    if (parentNode !== undefined) {
      parentNode.children.push(infoNode);
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
      const [domains, goals, tasks, infos, flows] = await Promise.all([
        listDomains(),
        listGoals(),
        listTasks(),
        listInfos(),
        listFlows(),
      ]);
      setTree(buildTree(domains, goals, tasks, infos, flows));
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
      const [domains, goals, tasks, infos, flows] = await Promise.all([
        listDomains(),
        listGoals(),
        listTasks(),
        listInfos(),
        listFlows(),
      ]);
      setTree(buildTree(domains, goals, tasks, infos, flows));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const createNode = useCallback(
    async (parentId: string, parentKind: NodeKind, childKind: NodeKind, title: string): Promise<MindmapNode> => {
      const dbParentId = dbIdFromNodeId(parentId);

      if (childKind === "domain" || childKind === "project" || childKind === "tag") {
        const domain = await createDomain({
          title, description: null, subtype: childKind,
          parent_id: dbParentId, status: null, knowledge_base_directory: null,
        });
        const newNode: MindmapNode = {
          id: `domain-${domain.id}`, kind: childKind, title: domain.title,
          position: domain.position, tagIds: [], children: [],
        };
        await silentLoad();
        return newNode;
      }

      if (childKind === "goal") {
        const goal = await createGoal({ title, parent_type: kindToParentType(parentKind), parent_id: dbParentId });
        const newNode: MindmapNode = {
          id: `goal-${goal.id}`, kind: "goal", title: goal.title,
          status: goal.status, position: goal.position, tagIds: [], children: [],
        };
        await silentLoad();
        return newNode;
      }

      if (childKind === "task") {
        const task = await createTask({ title, parent_type: kindToParentType(parentKind), parent_id: dbParentId });
        const newNode: MindmapNode = {
          id: `task-${task.id}`, kind: "task", title: task.title,
          status: task.status, position: task.position, tagIds: [], children: [],
        };
        await silentLoad();
        return newNode;
      }

      if (childKind === "info") {
        const siblings = findNodeInTree(tree, parentId)?.children ?? [];
        const maxPos = siblings.reduce((m, c) => Math.max(m, c.position), -1);
        const info = await createInfo({
          body: title, parent_type: kindToInfoParentType(parentKind),
          parent_id: dbParentId, position: maxPos + 1,
        });
        const newNode: MindmapNode = {
          id: `info-${info.id}`, kind: "info", title: info.body,
          position: info.position, tagIds: [], children: [],
        };
        await silentLoad();
        return newNode;
      }

      throw new Error(`Cannot create a node of kind "${childKind}"`);
    },
    [silentLoad, tree],
  );

  const createChild = useCallback(
    async (parentId: string, parentKind: NodeKind, title: string): Promise<MindmapNode> => {
      const childKind: NodeKind =
        parentKind === "info" ? "info"
        : parentKind === "project" ? "project"
        : parentKind === "goal" ? "goal"
        : parentKind === "task" ? "task"
        : "domain"; // aspect, domain → domain
      return createNode(parentId, parentKind, childKind, title);
    },
    [createNode],
  );

  const renameNode = useCallback(
    async (id: string, kind: NodeKind, title: string): Promise<void> => {
      const dbId = dbIdFromNodeId(id);
      if (kind === "goal") {
        await updateGoal(dbId, { title });
      } else if (kind === "task") {
        await updateTask(dbId, { title });
      } else if (kind === "info") {
        await updateInfo(dbId, { body: title });
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
            } else if (child.kind === "info") {
              await updateInfo(childDbId, { parent_type: "goal", parent_id: newGoal.id });
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
            } else if (child.kind === "info") {
              await updateInfo(childDbId, { parent_type: "task", parent_id: newTask.id });
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
          } else if (child.kind === "info") {
            await updateInfo(childDbId, { parent_type: toKind, parent_id: newDomain.id });
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
          } else if (child.kind === "info") {
            await updateInfo(childDbId, { parent_type: "goal", parent_id: newGoal.id });
          }
        }
        await deleteTask(dbId);
        await silentLoad();
        return `goal-${newGoal.id}`;
      }

      // To info: create info entry, re-parent info children, handle non-info children.
      if (toKind === "info") {
        if (parentDbId === null) return null;
        const parentInfoType = kindToInfoParentType(parent!.kind);
        const newInfo = await createInfo({
          body: title, parent_type: parentInfoType, parent_id: parentDbId,
          position: oldPosition ?? 0,
        });
        for (const child of children) {
          const childDbId = dbIdFromNodeId(child.id);
          if (child.kind === "info") {
            await updateInfo(childDbId, { parent_type: "info", parent_id: newInfo.id });
          } else {
            if (options?.infoChildrenAction === "reparent") {
              if (child.kind === "goal") {
                await updateGoal(childDbId, { parent_type: kindToParentType(parent!.kind), parent_id: parentDbId });
              } else if (child.kind === "task") {
                await updateTask(childDbId, { parent_type: kindToParentType(parent!.kind), parent_id: parentDbId });
              } else {
                await updateDomain(childDbId, { parent_id: parentDbId });
              }
            } else {
              if (child.kind === "goal") await deleteGoal(childDbId);
              else if (child.kind === "task") await deleteTask(childDbId);
              else if (child.kind !== "aspect") await deleteDomain(childDbId);
            }
          }
        }
        if (fromKind === "goal") await deleteGoal(dbId);
        else if (fromKind === "task") await deleteTask(dbId);
        else if (fromKind !== "aspect") await deleteDomain(dbId);
        await silentLoad();
        return `info-${newInfo.id}`;
      }

      // From info: create new entity, re-parent info children, delete info entry.
      if (fromKind === "info") {
        if (parentDbId === null) return null;
        if (toKind === "goal" || toKind === "task") {
          const parentType = kindToParentType(parent!.kind);
          if (toKind === "goal") {
            const newGoal = await createGoal({ title, parent_type: parentType, parent_id: parentDbId });
            if (oldPosition !== undefined) await updateGoal(newGoal.id, { position: oldPosition });
            for (const child of children) {
              if (child.kind === "info") {
                await updateInfo(dbIdFromNodeId(child.id), { parent_type: "goal", parent_id: newGoal.id });
              }
            }
            await deleteInfo(dbId);
            await silentLoad();
            return `goal-${newGoal.id}`;
          } else {
            const newTask = await createTask({ title, parent_type: parentType, parent_id: parentDbId });
            if (oldPosition !== undefined) await updateTask(newTask.id, { position: oldPosition });
            for (const child of children) {
              if (child.kind === "info") {
                await updateInfo(dbIdFromNodeId(child.id), { parent_type: "task", parent_id: newTask.id });
              }
            }
            await deleteInfo(dbId);
            await silentLoad();
            return `task-${newTask.id}`;
          }
        }
        if (domainTableKinds.has(toKind)) {
          const newDomain = await createDomain({
            title, subtype: toKind, parent_id: parentDbId,
            description: null, status: null, knowledge_base_directory: null,
          });
          if (oldPosition !== undefined) await updateDomain(newDomain.id, { position: oldPosition });
          for (const child of children) {
            if (child.kind === "info") {
              await updateInfo(dbIdFromNodeId(child.id), { parent_type: toKind, parent_id: newDomain.id });
            }
          }
          await deleteInfo(dbId);
          await silentLoad();
          return `domain-${newDomain.id}`;
        }
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
        else if (kind === "info") await updateInfo(nId, { position: pos });
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
    async (id: string, kind: NodeKind, newParentId: string, newParentKind: NodeKind, position: number): Promise<void> => {
      const dbId = dbIdFromNodeId(id);
      const dbParentId = dbIdFromNodeId(newParentId);
      if (kind === "goal") {
        await updateGoal(dbId, { parent_type: kindToParentType(newParentKind), parent_id: dbParentId, position });
      } else if (kind === "task") {
        await updateTask(dbId, { parent_type: kindToParentType(newParentKind), parent_id: dbParentId, position });
      } else if (kind === "info") {
        await updateInfo(dbId, { parent_type: kindToInfoParentType(newParentKind), parent_id: dbParentId, position });
      } else {
        await import("@/api/domains").then(({ updateDomain }) =>
          updateDomain(dbId, { parent_id: dbParentId, position }),
        );
      }
      await silentLoad();
    },
    [silentLoad],
  );

  const removeNode = useCallback(
    async (nodesToDelete: Array<{ id: string; kind: NodeKind }>): Promise<void> => {
      for (const { id, kind } of nodesToDelete) {
        const dbId = dbIdFromNodeId(id);
        if (kind === "goal") await deleteGoal(dbId);
        else if (kind === "task") await deleteTask(dbId);
        else if (kind === "info") await deleteInfo(dbId);
        else if (kind === "flow") await deleteFlow(dbId);
        else if (kind !== "aspect") await deleteDomain(dbId);
      }
      await silentLoad();
    },
    [silentLoad],
  );

  const createFlowNode = useCallback(
    async (request: CreateFlowRequest): Promise<Flow> => {
      const flow = await createFlow(request);
      await silentLoad();
      return flow;
    },
    [silentLoad],
  );

  const updateFlowNode = useCallback(
    async (id: number, request: UpdateFlowRequest): Promise<void> => {
      await updateFlow(id, request);
      await silentLoad();
    },
    [silentLoad],
  );

  return {
    tree,
    isLoading,
    error,
    createNode,
    createChild,
    renameNode,
    retypeNode,
    reorderNode,
    moveNode,
    removeNode,
    createFlow: createFlowNode,
    updateFlow: updateFlowNode,
    reload: silentLoad,
  };
}
