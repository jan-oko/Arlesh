import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMindmapData } from "@/components/MindmapView/use-mindmap-data";
import { collectSearchableNodes, flattenNodesById } from "@/utils/mindmap-tree";
import {
  isTaskStatusValue, isGoalStatusValue, isProjectStatusValue, isScopeStateValue, isBlockedValue,
} from "@/utils/list-filter";

/** Node kinds a Task/Goal/Project can be parented under — the pool for the Parent/Antecedent pickers. */
const PARENT_KINDS = new Set(["aspect", "domain", "project", "goal", "task"]);

export interface EntityOption {
  id: string;
  label: string;
  /** The node's own (or nearest-aspect-inherited) color, for a picker swatch / chip tint. */
  color: string | null;
}

export interface TagOption {
  id: number;
  label: string;
  color: string | null;
}

function tagDbId(nodeId: string): number {
  const parts = nodeId.split("-");
  return parseInt(parts[parts.length - 1] ?? "", 10);
}

export interface FilterDisplay {
  /** Every tag, for the tag search combobox. */
  tagOptions: TagOption[];
  tagName: (id: number) => string;
  tagColor: (id: number) => string | null;
  /** Any tree node's title/color by id — resolves parent/antecedent/dependency chip and pill labels. */
  nodeLabel: (ref: string) => string;
  nodeColor: (ref: string) => string | null;
  parentPool: EntityOption[];
  dependencyPool: EntityOption[];
  displayTaskStatus: (value: string) => string;
  displayGoalStatus: (value: string) => string;
  displayProjectStatus: (value: string) => string;
  displayScopeState: (value: string) => string;
  displayBlocked: (value: string) => string;
}

/**
 * Resolves display names and aspect colors for every filterable entity/enum value, from a single
 * shared tree fetch — used by both the FilterPopover (candidate pickers) and FilterChips (active
 * chips) so neither duplicates the tree load or the label/color derivation.
 */
export function useFilterDisplay(): FilterDisplay {
  const { t } = useTranslation(["status", "listView"]);
  const { tree } = useMindmapData();

  const nodeById = useMemo(() => flattenNodesById(tree), [tree]);
  const searchableNodes = useMemo(() => collectSearchableNodes(tree), [tree]);

  const tagOptions = useMemo<TagOption[]>(
    () => searchableNodes
      .filter((n) => n.kind === "tag" && n.title.trim() !== "")
      .map((n) => ({ id: tagDbId(n.id), label: n.title, color: nodeById.get(n.id)?.color ?? null })),
    [searchableNodes, nodeById],
  );
  const tagOptionById = useMemo(() => new Map(tagOptions.map((opt) => [opt.id, opt])), [tagOptions]);

  const parentPool = useMemo<EntityOption[]>(
    () => searchableNodes
      .filter((n) => PARENT_KINDS.has(n.kind))
      .map((n) => ({ id: n.id, label: n.title, color: nodeById.get(n.id)?.color ?? null })),
    [searchableNodes, nodeById],
  );
  const dependencyPool = useMemo<EntityOption[]>(
    () => searchableNodes
      .filter((n) => n.kind === "task" || n.kind === "goal")
      .map((n) => ({ id: n.id, label: n.title, color: nodeById.get(n.id)?.color ?? null })),
    [searchableNodes, nodeById],
  );

  return {
    tagOptions,
    tagName: (id) => tagOptionById.get(id)?.label ?? `#${id}`,
    tagColor: (id) => tagOptionById.get(id)?.color ?? null,
    nodeLabel: (ref) => nodeById.get(ref)?.title ?? ref,
    nodeColor: (ref) => nodeById.get(ref)?.color ?? null,
    parentPool,
    dependencyPool,
    displayTaskStatus: (value) => (isTaskStatusValue(value) ? t(`status:task.${value}`) : value),
    displayGoalStatus: (value) => (isGoalStatusValue(value) ? t(`status:goal.${value}`) : value),
    displayProjectStatus: (value) => (isProjectStatusValue(value) ? t(`status:project.${value}`) : value),
    displayScopeState: (value) => (isScopeStateValue(value) ? t(`listView:scopeState.${value}`) : value),
    displayBlocked: (value) => (isBlockedValue(value) ? t(`listView:blockedState.${value}`) : value),
  };
}
