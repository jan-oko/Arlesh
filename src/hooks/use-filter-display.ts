import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMindmapData } from "@/components/MindmapView/use-mindmap-data";
import { collectSearchableNodes, flattenNodesById } from "@/utils/mindmap-tree";
import { rowIdOf } from "@/utils/node-identity";
import {
  isTaskStatusValue, isGoalStatusValue, isProjectStatusValue, isScopeStateValue, isBlockedValue,
  isVerdictValue, isAgenticValue, isAsynchronousValue,
} from "@/utils/list-filter";

/** Every node kind that can stand on a row's ancestor chain — the pool for the Antecedent picker.
 * The pool is the whole tree, the way `Ctrl+O`'s search is, not just the ancestors of rows that
 * happen to be on screen: filtering to a branch nothing visible descends from is exactly the case
 * the filter exists for. */
const ANTECEDENT_KINDS = new Set(["aspect", "domain", "project", "goal", "task"]);

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

export interface FilterDisplay {
  /** Every tag, for the tag search combobox. */
  tagOptions: TagOption[];
  tagName: (id: number) => string;
  tagColor: (id: number) => string | null;
  /** Any tree node's title/color by id — resolves antecedent/dependency chip and pill labels. */
  nodeLabel: (ref: string) => string;
  nodeColor: (ref: string) => string | null;
  antecedentPool: EntityOption[];
  dependencyPool: EntityOption[];
  displayTaskStatus: (value: string) => string;
  displayGoalStatus: (value: string) => string;
  displayProjectStatus: (value: string) => string;
  displayVerdict: (value: string) => string;
  displayScopeState: (value: string) => string;
  displayBlocked: (value: string) => string;
  displayAgentic: (value: string) => string;
  displayAsynchronous: (value: string) => string;
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
    () => [...nodeById.values()]
      .filter((n) => n.kind === "tag" && n.title.trim() !== "")
      .map((n) => ({ id: rowIdOf(n), label: n.title, color: n.color ?? null })),
    [nodeById],
  );
  const tagOptionById = useMemo(() => new Map(tagOptions.map((opt) => [opt.id, opt])), [tagOptions]);

  const antecedentPool = useMemo<EntityOption[]>(
    () => searchableNodes
      .filter((n) => ANTECEDENT_KINDS.has(n.kind))
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
    antecedentPool,
    dependencyPool,
    displayTaskStatus: (value) => (isTaskStatusValue(value) ? t(`status:task.${value}`) : value),
    displayGoalStatus: (value) => (isGoalStatusValue(value) ? t(`status:goal.${value}`) : value),
    displayProjectStatus: (value) => (isProjectStatusValue(value) ? t(`status:project.${value}`) : value),
    displayVerdict: (value) => (isVerdictValue(value) ? t(`status:commitment.${value}`) : value),
    displayScopeState: (value) => (isScopeStateValue(value) ? t(`listView:scopeState.${value}`) : value),
    displayBlocked: (value) => (isBlockedValue(value) ? t(`listView:blockedState.${value}`) : value),
    displayAgentic: (value) => (isAgenticValue(value) ? t(`listView:agenticState.${value}`) : value),
    displayAsynchronous: (value) =>
      (isAsynchronousValue(value) ? t(`listView:asynchronousState.${value}`) : value),
  };
}
