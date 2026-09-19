import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTabRename } from "./use-tab-rename";
import { reloadTabs, useTabsStore } from "@/stores/use-tabs-store";

beforeEach(() => {
  localStorage.clear();
  reloadTabs();
});

function onlyTabId(): string {
  return useTabsStore.getState().tabs[0]?.id ?? "";
}

function customTitle(): string | null {
  return useTabsStore.getState().tabs[0]?.customTitle ?? null;
}

describe("editing a tab's name", () => {
  it("names the tab being edited, and closes the editor", () => {
    const id = onlyTabId();
    const { result } = renderHook(() => useTabRename());

    act(() => result.current.start(id));
    expect(result.current.editingId).toBe(id);
    act(() => result.current.commit(id, "Today"));

    expect(customTitle()).toBe("Today");
    expect(result.current.editingId).toBeNull();
  });

  it("takes the name off when the field is committed empty", () => {
    const id = onlyTabId();
    const { result } = renderHook(() => useTabRename());
    act(() => result.current.commit(id, "Today"));

    act(() => result.current.start(id));
    act(() => result.current.commit(id, "   "));

    expect(customTitle()).toBeNull();
  });

  it("leaves the name exactly as it was when the edit is cancelled", () => {
    const id = onlyTabId();
    const { result } = renderHook(() => useTabRename());
    act(() => result.current.commit(id, "Today"));

    act(() => result.current.start(id));
    act(() => result.current.cancel());

    expect(customTitle()).toBe("Today");
    expect(result.current.editingId).toBeNull();
  });

  it("ignores the blur that cancelling itself causes, which would write the refused value back", () => {
    const id = onlyTabId();
    const { result } = renderHook(() => useTabRename());
    act(() => result.current.commit(id, "Today"));

    act(() => result.current.start(id));
    act(() => {
      result.current.cancel();
      // What the input does on its way out: Escape moved focus, so a blur arrives carrying the text
      // that was on screen when Escape was pressed.
      result.current.commit(id, "Todayyy");
    });

    expect(customTitle()).toBe("Today");
  });
});
