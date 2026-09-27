import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import SubtreeBreadcrumb from "./SubtreeBreadcrumb";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import type { SubtreeCrumb } from "@/stores/use-mindmap-store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

/** `Arlesh › A-one › B-two › C-three › Deep` — deep enough that a fold has a middle to take. */
const ANCESTORS: readonly SubtreeCrumb[] = [
  { id: null, title: "Arlesh" },
  { id: "a-1", title: "A-one" },
  { id: "a-2", title: "B-two" },
  { id: "a-3", title: "C-three" },
];

const CHARACTER_WIDTH = 10;

/**
 * jsdom lays nothing out, so the chain is given widths to measure: one fixed box, and a chain as
 * wide as the text it is currently showing. That is enough for the real folding loop to run —
 * every fold shortens the text, so the measurement it takes next is a different one.
 */
function giveChainRoom(availableWidth: number) {
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return (this.getAttribute("class") ?? "").includes("chain") ? availableWidth : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
    configurable: true,
    get(this: HTMLElement) {
      if (!(this.getAttribute("class") ?? "").includes("chain")) return 0;
      return (this.textContent ?? "").length * CHARACTER_WIDTH;
    },
  });
}

function enterDeepSubtree() {
  useMindmapStore.setState({
    subtreeRootId: "deep",
    subtreeNav: { ancestors: ANCESTORS, currentTitle: "Deep" },
  });
}

/**
 * A `ResizeObserver` a test can drive: it remembers what it watches, and `resizeTo` reports a new
 * width to every observer watching a box that is still in the document — which is all a browser
 * would ever report on.
 */
class ScriptedResizeObserver implements ResizeObserver {
  static live = new Set<ScriptedResizeObserver>();
  private readonly watched = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element): void {
    this.watched.add(target);
    ScriptedResizeObserver.live.add(this);
  }

  unobserve(target: Element): void {
    this.watched.delete(target);
  }

  disconnect(): void {
    this.watched.clear();
    ScriptedResizeObserver.live.delete(this);
  }

  report(width: number): void {
    const entries = [...this.watched]
      .filter((target) => target.isConnected)
      .map(
        (target) =>
          ({
            target,
            contentRect: new DOMRect(0, 0, width, 20),
            borderBoxSize: [],
            contentBoxSize: [],
            devicePixelContentBoxSize: [],
          }) satisfies ResizeObserverEntry,
      );
    if (entries.length === 0) return;
    this.callback(entries, this);
  }
}

/** The window (or a pane beside the bar) changes size: the box gets `width`, and says so. */
function resizeTo(width: number) {
  giveChainRoom(width);
  act(() => {
    for (const observer of ScriptedResizeObserver.live) observer.report(width);
  });
}

const originalResizeObserver = globalThis.ResizeObserver;

beforeEach(() => {
  useMindmapStore.setState({ subtreeRootId: null, subtreeNav: null });
  ScriptedResizeObserver.live.clear();
  globalThis.ResizeObserver = ScriptedResizeObserver;
});

afterEach(() => {
  globalThis.ResizeObserver = originalResizeObserver;
  Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
  Reflect.deleteProperty(HTMLElement.prototype, "scrollWidth");
});

describe("SubtreeBreadcrumb", () => {
  it("draws nothing at the true root", () => {
    const { container } = render(<SubtreeBreadcrumb />);
    expect(container).toBeEmptyDOMElement();
  });

  it("runs from the true root to where you are", () => {
    giveChainRoom(1000);
    enterDeepSubtree();
    render(<SubtreeBreadcrumb />);
    for (const title of ["Arlesh", "A-one", "B-two", "C-three"]) {
      expect(screen.getByRole("button", { name: title })).toBeInTheDocument();
    }
    expect(screen.getByText("Deep")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Deep" })).not.toBeInTheDocument();
  });

  it("names itself for a screen reader, rather than prefixing the run of titles", () => {
    giveChainRoom(1000);
    enterDeepSubtree();
    render(<SubtreeBreadcrumb />);
    expect(screen.getByRole("navigation", { name: "insideSubtree" })).toBeInTheDocument();
  });

  it("opens with the root's title and no glyph before it", () => {
    giveChainRoom(1000);
    enterDeepSubtree();
    const { container } = render(<SubtreeBreadcrumb />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("enters exactly the middle level whose segment is clicked", () => {
    giveChainRoom(1000);
    enterDeepSubtree();
    render(<SubtreeBreadcrumb />);
    fireEvent.click(screen.getByRole("button", { name: "B-two" }));
    expect(useMindmapStore.getState().subtreeRootId).toBe("a-2");
  });

  it("leaves the subtree entirely from the first segment, the true root", () => {
    giveChainRoom(1000);
    enterDeepSubtree();
    render(<SubtreeBreadcrumb />);
    fireEvent.click(screen.getByRole("button", { name: "Arlesh" }));
    expect(useMindmapStore.getState().subtreeRootId).toBeNull();
    expect(useMindmapStore.getState().selectedNodeId).toBeNull();
  });

  it("folds nothing while the chain fits", () => {
    giveChainRoom(1000);
    enterDeepSubtree();
    render(<SubtreeBreadcrumb />);
    expect(screen.queryByRole("button", { name: "foldedLevels" })).not.toBeInTheDocument();
  });

  describe("a chain too long for the bar", () => {
    beforeEach(() => {
      giveChainRoom(200);
      enterDeepSubtree();
    });

    it("keeps the first and last segments and folds the middle away", () => {
      render(<SubtreeBreadcrumb />);
      expect(screen.getByRole("button", { name: "Arlesh" })).toBeInTheDocument();
      expect(screen.getByText("Deep")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "A-one" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "foldedLevels" })).toBeInTheDocument();
    });

    it("folds the levels nearest the root first, keeping the nearest ones on the bar", () => {
      render(<SubtreeBreadcrumb />);
      expect(screen.getByRole("button", { name: "C-three" })).toBeInTheDocument();
    });

    it("reaches every folded level through the menu", () => {
      render(<SubtreeBreadcrumb />);
      fireEvent.click(screen.getByRole("button", { name: "foldedLevels" }));
      const folded = screen.getAllByRole("menuitem").map((item) => item.textContent);
      expect(folded).toEqual(["A-one", "B-two"]);
    });

    it("enters the folded level picked from the menu", () => {
      render(<SubtreeBreadcrumb />);
      fireEvent.click(screen.getByRole("button", { name: "foldedLevels" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "B-two" }));
      expect(useMindmapStore.getState().subtreeRootId).toBe("a-2");
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("closes the menu on Escape, which is otherwise free here", () => {
      render(<SubtreeBreadcrumb />);
      fireEvent.click(screen.getByRole("button", { name: "foldedLevels" }));
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("leaves Shift+Escape to the subtree binding it belongs to", () => {
      render(<SubtreeBreadcrumb />);
      fireEvent.click(screen.getByRole("button", { name: "foldedLevels" }));
      fireEvent.keyDown(window, { key: "Escape", shiftKey: true });
      expect(screen.getByRole("menu")).toBeInTheDocument();
    });
  });

  describe("following the bar's width", () => {
    it("unfolds every level again once the bar has room, for a subtree entered while it was narrow", () => {
      giveChainRoom(200);
      render(<SubtreeBreadcrumb />);
      act(() => enterDeepSubtree());
      expect(screen.getByRole("button", { name: "foldedLevels" })).toBeInTheDocument();

      resizeTo(1000);

      expect(screen.queryByRole("button", { name: "foldedLevels" })).not.toBeInTheDocument();
      for (const title of ["A-one", "B-two", "C-three"]) {
        expect(screen.getByRole("button", { name: title })).toBeInTheDocument();
      }
    });

    it("folds the middle away as the bar narrows", () => {
      giveChainRoom(1000);
      enterDeepSubtree();
      render(<SubtreeBreadcrumb />);
      resizeTo(1000);
      expect(screen.queryByRole("button", { name: "foldedLevels" })).not.toBeInTheDocument();

      resizeTo(200);

      expect(screen.getByRole("button", { name: "foldedLevels" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "A-one" })).not.toBeInTheDocument();
    });

    it("unfolds only as many levels as the new width holds", () => {
      giveChainRoom(200);
      enterDeepSubtree();
      render(<SubtreeBreadcrumb />);

      // `Arlesh…B-twoC-threeDeep` is 23 characters: room for one fold, not for none.
      resizeTo(250);

      fireEvent.click(screen.getByRole("button", { name: "foldedLevels" }));
      const folded = screen.getAllByRole("menuitem").map((item) => item.textContent);
      expect(folded).toEqual(["A-one"]);
    });

    it("keeps following it after the subtree is left and entered again", () => {
      giveChainRoom(1000);
      enterDeepSubtree();
      render(<SubtreeBreadcrumb />);
      act(() => useMindmapStore.setState({ subtreeRootId: null, subtreeNav: null }));
      act(() => enterDeepSubtree());

      resizeTo(200);

      expect(screen.getByRole("button", { name: "foldedLevels" })).toBeInTheDocument();
    });
  });
});
