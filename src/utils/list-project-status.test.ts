import { describe, it, expect } from "vitest";
import { buildTree } from "@/components/MindmapView/use-mindmap-data";
import { flattenTaskRows } from "@/utils/list-data";
import { filterTaskList, DEFAULT_LIST_FILTER } from "@/utils/list-filter";
import { DEFAULT_FILTER } from "@/utils/filter-tree";
import type { Domain } from "@/api/domains";
import type { Task } from "@/api/tasks";

/**
 * End-to-end cover for List View's Project-status filter: tree -> rows -> filter.
 *
 * The existing `list-filter` tests hand-build a `TaskListRow` with `projectStatus` already
 * populated, so they cannot catch the status failing to travel from the Domain row onto the tree
 * node and out to the row. That whole path had no test.
 */

const ASPECT: Domain = {
  id: 2, title: "Connections", description: null, subtype: "aspect",
  parent_id: null, color: null, status: null, knowledge_base_directory: null,
  position: 0, is_private: false,
};
const PROJECT: Domain = {
  id: 25, title: "LOVE", description: null, subtype: "project",
  parent_id: 2, color: null, status: "active", knowledge_base_directory: null,
  position: 0, is_private: false,
};
const TASK: Task = {
  id: 25, title: "talk to M", parent_type: "project", parent_id: 25,
  status: "todo", delegate_to: null, time_scope: null, on_scope_exit: null,
  plan: null, archival: "live", tag_ids: [], position: 0, is_private: false,
};

const ACTIVE_PILL = {
  ...DEFAULT_LIST_FILTER.pills,
  projectStatus: [{ value: "active", mode: "any" as const }],
};

function rowsFor(domains: Domain[]) {
  return flattenTaskRows(buildTree(domains, [], [TASK], []), []);
}

describe("List View: filtering by Project status", () => {
  it("carries a project's status from the domain row onto the task row", () => {
    const rows = rowsFor([ASPECT, PROJECT]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.projectRef).toBe("domain-25");
    expect(rows[0]?.projectStatus).toBe("active");
  });

  it("keeps a task whose project is active", () => {
    const kept = filterTaskList(
      rowsFor([ASPECT, PROJECT]),
      { ...DEFAULT_FILTER, statusMode: "all" },
      { ...DEFAULT_LIST_FILTER, preset: "all", pills: ACTIVE_PILL },
    );
    expect(kept).toHaveLength(1);
  });

  it("drops a task whose project is frozen", () => {
    const kept = filterTaskList(
      rowsFor([ASPECT, { ...PROJECT, status: "frozen" }]),
      { ...DEFAULT_FILTER, statusMode: "all" },
      { ...DEFAULT_LIST_FILTER, preset: "all", pills: ACTIVE_PILL },
    );
    expect(kept).toHaveLength(0);
  });

  // Migration 0023 and the create-side default mean a Project always stores a status now. Before
  // them a NULL produced no value to match, so filtering by "active" hid every unset Project's
  // tasks — the majority of them — which read as a filter that returned nothing at all.
  it("a project with no stored status matches nothing, which is why 0023 backfills it", () => {
    const rows = rowsFor([ASPECT, { ...PROJECT, status: null }]);
    expect(rows[0]?.projectStatus).toBeNull();

    const kept = filterTaskList(
      rows,
      { ...DEFAULT_FILTER, statusMode: "all" },
      { ...DEFAULT_LIST_FILTER, preset: "all", pills: ACTIVE_PILL },
    );
    expect(kept).toHaveLength(0);
  });

  // Independent of status: a private ancestor hides the row unless Private Mode is on. This is
  // what made a correctly-filtered, non-empty result look like a broken filter.
  it("hides a task under a private project unless Private Mode is on", () => {
    const rows = rowsFor([ASPECT, { ...PROJECT, is_private: true }]);
    expect(rows[0]?.hasPrivateAncestor).toBe(true);

    const listFilter = { ...DEFAULT_LIST_FILTER, preset: "all" as const, pills: ACTIVE_PILL };
    const hidden = filterTaskList(rows, { ...DEFAULT_FILTER, statusMode: "all", privateMode: false }, listFilter);
    const shown = filterTaskList(rows, { ...DEFAULT_FILTER, statusMode: "all", privateMode: true }, listFilter);

    expect(hidden).toHaveLength(0);
    expect(shown).toHaveLength(1);
  });
});
