import { describe, expect, it } from "vitest";
import { isWriteCommand } from "./writes";

describe("isWriteCommand", () => {
  it.each([
    "listView.cycleStatus", "mindmap.enter", "zenView.toggleReleaseEnter", "stepsView.createChild",
    "listView.undo", "mindmap.paste", "planView.moveAcross", "planView.subscope.M", "touch.newTask",
  ])("reads %s as a write", (id) => {
    expect(isWriteCommand(id)).toBe(true);
  });

  it.each([
    "global.openSearch", "global.openFilterSearch", "tabs.next", "listView.status.do", "listView.preset.unblock",
    "mindmap.navigate.ArrowUp", "mindmap.zoomIn", "mindmap.toggleCollapsed", "listView.openEditor", "mindmap.copy",
    "planView.nextScope", "planView.kind.week", "stepsView.descend", "zenView.navigate.up",
  ])("reads %s as reading only", (id) => {
    expect(isWriteCommand(id)).toBe(false);
  });
});
