import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { reloadTabs, useTabsStore } from "@/stores/use-tabs-store";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { ANSWER_FIELD, ANSWER_WAIT } from "@/utils/answer-focus";
import { REQUESTED_WAIT_PATIENCE_MS, useShowRequestedWait } from "@/hooks/use-show-requested-wait";

function Probe({ drawn }: { drawn: number }) {
  useShowRequestedWait(drawn);
  return (
    <div>
      {[1, 2].map((n) => (
        <div key={n} {...{ [ANSWER_WAIT]: `w-${n}` }}>
          <textarea data-testid={`box-${n}`} {...{ [ANSWER_FIELD]: "" }} />
        </div>
      ))}
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  reloadTabs();
  useTabsStore.getState();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { vi.useRealTimers(); });

describe("useShowRequestedWait", () => {
  it("focuses the box of the wait asked for, not another box of the same Task", () => {
    useMindmapStore.getState().requestSelection("task-1", { id: "w-2", focus: true });
    const { getByTestId } = render(<Probe drawn={1} />);

    expect(document.activeElement).toBe(getByTestId("box-2"));
    expect(useMindmapStore.getState().requestedWait).toBeNull();
  });

  it("scrolls the box into view without focusing it when asked not to focus (the phone)", () => {
    useMindmapStore.getState().requestSelection("task-1", { id: "w-1", focus: false });
    const { getByTestId } = render(<Probe drawn={1} />);

    expect(document.activeElement).not.toBe(getByTestId("box-1"));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(useMindmapStore.getState().requestedWait).toBeNull();
  });

  it("focuses nothing for a wait that is gone, and lets the request lapse", () => {
    vi.useFakeTimers();
    useMindmapStore.getState().requestSelection("task-1", { id: "w-9", focus: true });
    render(<Probe drawn={1} />);

    expect(document.activeElement).toBe(document.body);
    act(() => { vi.advanceTimersByTime(REQUESTED_WAIT_PATIENCE_MS); });
    expect(useMindmapStore.getState().requestedWait).toBeNull();
  });
});
