import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import NodeContextMenu from "./NodeContextMenu";
import { useFilterStore } from "@/stores/use-filter-store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { dir: () => "ltr" },
  }),
}));

const defaultProps = {
  x: 100,
  y: 200,
  nodeKind: "domain" as const,
  isCollapsed: false,
  hasClipboard: true,
  onAction: vi.fn(),
  onClose: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  useFilterStore.getState().reset();
});

describe("NodeContextMenu — always-visible items", () => {
  it("renders rename button for all node kinds", () => {
    render(<NodeContextMenu {...defaultProps} />);
    expect(screen.getByRole("button", { name: "rename" })).toBeInTheDocument();
  });

  it("renders cut, copy, and delete buttons", () => {
    render(<NodeContextMenu {...defaultProps} />);
    expect(screen.getByRole("button", { name: "cut" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "copy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "delete" })).toBeInTheDocument();
  });

  it("calls onAction and onClose when rename is clicked", () => {
    render(<NodeContextMenu {...defaultProps} />);
    fireEvent.click(screen.getByRole("button", { name: "rename" }));
    expect(defaultProps.onAction).toHaveBeenCalledWith("rename");
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });
});

describe("NodeContextMenu — canEnter", () => {
  it("shows enterSubtree for domain nodes", () => {
    render(<NodeContextMenu {...defaultProps} nodeKind="domain" />);
    expect(screen.getByRole("button", { name: "enterSubtree" })).toBeInTheDocument();
  });

  it("shows enterSubtree for aspect nodes", () => {
    render(<NodeContextMenu {...defaultProps} nodeKind="aspect" />);
    expect(screen.getByRole("button", { name: "enterSubtree" })).toBeInTheDocument();
  });

  it("hides enterSubtree for task nodes", () => {
    render(<NodeContextMenu {...defaultProps} nodeKind="task" />);
    expect(screen.queryByRole("button", { name: "enterSubtree" })).not.toBeInTheDocument();
  });

  it("hides enterSubtree for goal nodes", () => {
    render(<NodeContextMenu {...defaultProps} nodeKind="goal" />);
    expect(screen.queryByRole("button", { name: "enterSubtree" })).not.toBeInTheDocument();
  });

  it("hides enterSubtree for tag nodes", () => {
    render(<NodeContextMenu {...defaultProps} nodeKind="tag" />);
    expect(screen.queryByRole("button", { name: "enterSubtree" })).not.toBeInTheDocument();
  });
});

describe("NodeContextMenu — Set type submenu", () => {
  it("shows a Set type entry with the valid target kinds for domain nodes", () => {
    render(<NodeContextMenu {...defaultProps} nodeKind="domain" />);
    expect(screen.getByRole("button", { name: /setType/ })).toBeInTheDocument();
    // Under a domain-table parent the cycle offers goal/task/etc (not the current "domain").
    expect(screen.getByRole("button", { name: "nodeKinds:goal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "nodeKinds:task" })).toBeInTheDocument();
  });

  it("dispatches set-type:<kind> when a submenu option is clicked", () => {
    render(<NodeContextMenu {...defaultProps} nodeKind="domain" />);
    fireEvent.click(screen.getByRole("button", { name: "nodeKinds:task" }));
    expect(defaultProps.onAction).toHaveBeenCalledWith("set-type:task");
  });

  it("hides Set type for aspect nodes", () => {
    render(<NodeContextMenu {...defaultProps} nodeKind="aspect" />);
    expect(screen.queryByRole("button", { name: /setType/ })).not.toBeInTheDocument();
  });

  it("omits a kind the filter hides, which would convert the node and hide it at once", () => {
    useFilterStore.setState((s) => ({ filter: { ...s.filter, showInfo: false } }));
    render(<NodeContextMenu {...defaultProps} nodeKind="domain" parentKind="aspect" />);
    expect(screen.queryByRole("button", { name: "nodeKinds:info" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "nodeKinds:task" })).toBeInTheDocument();
  });

  it("offers that kind again once the filter shows it", () => {
    render(<NodeContextMenu {...defaultProps} nodeKind="domain" parentKind="aspect" />);
    expect(screen.getByRole("button", { name: "nodeKinds:info" })).toBeInTheDocument();
  });

  it("omits target kinds that couldn't hold the node's children", () => {
    // A goal (under a domain) with a goal child: Task and Info can't hold a goal, so they're not offered.
    render(<NodeContextMenu {...defaultProps} nodeKind="goal" parentKind="domain" childKinds={["goal"]} />);
    expect(screen.getByRole("button", { name: "nodeKinds:domain" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "nodeKinds:task" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "nodeKinds:info" })).not.toBeInTheDocument();
  });
});

describe("NodeContextMenu — newFlow", () => {
  it.each(["aspect", "domain", "project", "goal"] as const)("shows New Flow for %s nodes", (nodeKind) => {
    render(<NodeContextMenu {...defaultProps} nodeKind={nodeKind} />);
    expect(screen.getByRole("button", { name: "newFlow" })).toBeInTheDocument();
  });

  it.each(["task", "tag"] as const)("hides New Flow for %s nodes", (nodeKind) => {
    render(<NodeContextMenu {...defaultProps} nodeKind={nodeKind} />);
    expect(screen.queryByRole("button", { name: "newFlow" })).not.toBeInTheDocument();
  });

  it("emits the new-flow action when clicked", () => {
    render(<NodeContextMenu {...defaultProps} nodeKind="goal" />);
    fireEvent.click(screen.getByRole("button", { name: "newFlow" }));
    expect(defaultProps.onAction).toHaveBeenCalledWith("new-flow");
  });
});

describe("NodeContextMenu — startFlow", () => {
  it("shows Start flow only for flow nodes", () => {
    render(<NodeContextMenu {...defaultProps} nodeKind="flow" />);
    expect(screen.getByRole("button", { name: "startFlow" })).toBeInTheDocument();
  });

  it("hides Start flow for non-flow nodes", () => {
    render(<NodeContextMenu {...defaultProps} nodeKind="goal" />);
    expect(screen.queryByRole("button", { name: "startFlow" })).not.toBeInTheDocument();
  });

  it("emits the start-flow action when clicked", () => {
    render(<NodeContextMenu {...defaultProps} nodeKind="flow" />);
    fireEvent.click(screen.getByRole("button", { name: "startFlow" }));
    expect(defaultProps.onAction).toHaveBeenCalledWith("start-flow");
  });
});

describe("NodeContextMenu — paste", () => {
  it("paste button is enabled when hasClipboard is true", () => {
    render(<NodeContextMenu {...defaultProps} hasClipboard={true} />);
    expect(screen.getByRole("button", { name: "pasteAsChild" })).not.toBeDisabled();
  });

  it("paste button is disabled when hasClipboard is false", () => {
    render(<NodeContextMenu {...defaultProps} hasClipboard={false} />);
    expect(screen.getByRole("button", { name: "pasteAsChild" })).toBeDisabled();
  });
});

describe("NodeContextMenu — collapse toggle", () => {
  it("shows collapse label when not collapsed", () => {
    render(<NodeContextMenu {...defaultProps} isCollapsed={false} />);
    expect(screen.getByRole("button", { name: "collapse" })).toBeInTheDocument();
  });

  it("shows expand label when collapsed", () => {
    render(<NodeContextMenu {...defaultProps} isCollapsed={true} />);
    expect(screen.getByRole("button", { name: "expand" })).toBeInTheDocument();
  });
});

describe("NodeContextMenu — outside click", () => {
  it("calls onClose on mousedown outside the menu", () => {
    render(
      <div>
        <NodeContextMenu {...defaultProps} />
        <div data-testid="outside" />
      </div>,
    );
    fireEvent.mouseDown(screen.getByTestId("outside"));
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it("does not call onClose on mousedown inside the menu", () => {
    render(<NodeContextMenu {...defaultProps} />);
    fireEvent.mouseDown(screen.getByRole("button", { name: "rename" }));
    expect(defaultProps.onClose).not.toHaveBeenCalled();
  });
});

describe("NodeContextMenu — convert to flow", () => {
  it("offers convert-to-flow for a goal/task under a valid flow parent", () => {
    render(<NodeContextMenu {...defaultProps} nodeKind="task" parentKind="goal" />);
    expect(screen.getByRole("button", { name: "convertToFlow" })).toBeInTheDocument();
  });

  it("hides convert-to-flow for a task under a task (no valid flow placement)", () => {
    render(<NodeContextMenu {...defaultProps} nodeKind="task" parentKind="task" />);
    expect(screen.queryByRole("button", { name: "convertToFlow" })).not.toBeInTheDocument();
  });

  it("hides convert-to-flow for non-goal/task kinds", () => {
    render(<NodeContextMenu {...defaultProps} nodeKind="domain" parentKind="aspect" />);
    expect(screen.queryByRole("button", { name: "convertToFlow" })).not.toBeInTheDocument();
  });

  it("dispatches convert-to-flow on click", () => {
    render(<NodeContextMenu {...defaultProps} nodeKind="goal" parentKind="project" />);
    fireEvent.click(screen.getByRole("button", { name: "convertToFlow" }));
    expect(defaultProps.onAction).toHaveBeenCalledWith("convert-to-flow");
  });
});
