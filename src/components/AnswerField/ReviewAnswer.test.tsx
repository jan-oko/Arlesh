import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MindmapNode } from "@/utils/tree-layout";
import ReviewAnswer from "./ReviewAnswer";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { dir: () => "ltr" } }),
}));

function review(links: { label: string; url: string }[] = []): MindmapNode {
  return {
    id: "expectation-5", rowId: 5, kind: "expectation", title: "Review #12", status: "pending", position: 0, tagIds: [], children: [],
    agentWaiting: {
      note: "Adds the thing", question: true, answer: null,
      review: { links, hand_tests: ["Open the board", "Press Enter"] },
    },
  };
}

describe("ReviewAnswer", () => {
  it("shows the title, summary, links and hand tests, the tests as a plain list with nothing to tick", () => {
    render(<ReviewAnswer review={review([{ label: "PR #12", url: "https://example.test/pull/12" }])} onSend={vi.fn()} />);
    expect(screen.getByText("Review #12")).toBeInTheDocument();
    expect(screen.getByText("Adds the thing")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "PR #12" })).toHaveAttribute("href", "https://example.test/pull/12");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("does not link an address that is not a web one", () => {
    render(<ReviewAnswer review={review([{ label: "Sneaky", url: "javascript:alert(1)" }])} onSend={vi.fn()} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Sneaky")).toBeInTheDocument();
  });

  it("approves with the user's note", async () => {
    const onSend = vi.fn().mockResolvedValue(true);
    render(<ReviewAnswer review={review()} onSend={onSend} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: " ship it " } });
    fireEvent.click(screen.getByRole("button", { name: "reviewApprove" }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith({ verdict: "approved", answer: "ship it" }));
  });

  it("requests changes without a note", async () => {
    const onSend = vi.fn().mockResolvedValue(true);
    render(<ReviewAnswer review={review()} onSend={onSend} />);
    fireEvent.click(screen.getByRole("button", { name: "reviewRequestChanges" }));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith({ verdict: "changes_requested" }));
  });

  it("calls Approve a merge when there is a PR link", () => {
    render(<ReviewAnswer review={review([{ label: "PR", url: "https://github.com/o/r/pull/3" }])} onSend={vi.fn()} />);
    expect(screen.getByRole("button", { name: "reviewApproveMerge" })).toBeInTheDocument();
  });
});
