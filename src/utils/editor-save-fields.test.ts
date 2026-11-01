import { describe, expect, it } from "vitest";
import type { TaskSaveData } from "@/components/TaskEditorModal/TaskEditorModal";
import type { MindmapNode } from "@/utils/tree-layout";
import { goalSaveFields, infoSaveFields, shownTitle, taskSaveFields } from "@/utils/editor-save-fields";

const node: MindmapNode = {
  id: "task-1", rowId: 1, kind: "task", title: "Write", tagIds: [], position: 0, children: [],
  status: "todo", taskStatus: { kind: "ordinary", status: "todo" },
};

const save: TaskSaveData = {
  title: "Write more", status: { kind: "ordinary", status: "todo" }, blockReasons: ["waiting"], tagIds: [3],
  addedDeps: [], removedDeps: [], timeScope: null, onScopeExit: null, plan: null, archival: "live",
  agentic: "inherit", asynchronous: false, compound: false, asyncTemplate: null, agenticBrief: null, isPrivate: false,
};

describe("taskSaveFields", () => {
  it("carries the form's own values and no derived field", () => {
    const fields = taskSaveFields(node, save);
    expect(fields).toMatchObject({
      title: "Write more", blockReasons: ["waiting"], tagIds: [3], plan: null, timeScope: null,
      agentic: null, asynchronous: false, agenticBrief: null,
    });
    for (const derived of ["inheritedPlan", "inheritedAgentic", "overdue", "timing", "blocked", "archived"]) {
      expect(fields).not.toHaveProperty(derived);
    }
  });

  it("patches no status when the form leaves it where it was", () => {
    expect(taskSaveFields(node, save)).not.toHaveProperty("status");
    expect(taskSaveFields(node, save)).not.toHaveProperty("taskStatus");
  });

  it("patches the status the form leaves, which is the converted one after an Agentic flag change", () => {
    const converted = taskSaveFields(node, {
      ...save, agentic: "yes", status: { kind: "agentic", status: "doing" },
    });
    expect(converted).toMatchObject({ agentic: true, status: "doing", taskStatus: { kind: "agentic", status: "doing" } });
  });

  it("does not turn a Review the form leaves alone into On Agent", () => {
    const review: MindmapNode = { ...node, status: "review", taskStatus: { kind: "agentic", status: "review" } };
    expect(taskSaveFields(review, { ...save, status: { kind: "agentic", status: "review" } })).not.toHaveProperty("status");
  });

  it("gives a Task that stays Compound no status patch", () => {
    const compound: MindmapNode = { ...node, compound: true };
    expect(taskSaveFields(compound, { ...save, compound: true, status: { kind: "ordinary", status: "done" } }))
      .not.toHaveProperty("status");
  });

  it("leaves the due alone when the form has no Due field", () => {
    expect(taskSaveFields(node, save)).not.toHaveProperty("dueScope");
    expect(taskSaveFields(node, { ...save, dueScope: null })).toHaveProperty("dueScope", null);
  });
});

describe("shownTitle", () => {
  it("keeps the label a node draws round its row title", () => {
    const labelled: MindmapNode = { ...node, title: "Write (W42)", rowTitle: "Write" };
    expect(shownTitle(labelled, "Draft")).toBe("Draft (W42)");
    expect(shownTitle(node, "Draft")).toBe("Draft");
  });
});

describe("other kinds", () => {
  it("a Goal shows its title, status, window, tags and block reasons", () => {
    expect(goalSaveFields({ ...node, kind: "goal", title: "G" }, {
      title: "G2", status: "achieved", blockReasons: [], tagIds: [], timeScope: null, onScopeExit: null, isPrivate: false,
    })).toEqual({ title: "G2", status: "achieved", timeScope: null, onScopeExit: null, tagIds: [], blockReasons: [] });
  });

  it("an Info shows its body as the title and its details", () => {
    expect(infoSaveFields({ body: "B", details: null, isPrivate: false })).toEqual({ title: "B", infoDetails: null });
  });
});
