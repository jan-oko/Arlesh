import { describe, expect, it } from "vitest";
import { gateWrites, isWriteCommand } from "./writes";

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

describe("gateWrites", () => {
  const commands = [
    { id: "mindmap.enter", canRun: () => true },
    { id: "mindmap.zoomIn", canRun: () => true },
  ];

  it("leaves the commands alone while the board can be written", () => {
    expect(gateWrites(commands, false).map((c) => c.canRun())).toEqual([true, true]);
  });

  it("stops the writes and keeps the reads while the board is read-only", () => {
    expect(gateWrites(commands, true).map((c) => c.canRun())).toEqual([false, true]);
  });
});
