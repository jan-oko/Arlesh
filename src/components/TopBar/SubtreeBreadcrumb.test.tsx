import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

beforeEach(() => {
  useMindmapStore.setState({ subtreeRootId: null, subtreeNav: null });
});

afterEach(() => {
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
});
