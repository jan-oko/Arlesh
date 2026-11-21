import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@/i18n";
import AnchoredToast from "@/components/AnchoredToast/AnchoredToast";
import AgentStatus from "@/components/TopBar/AgentStatus";
import { useAgentActivityStore } from "@/stores/use-agent-activity-store";
import { useBoardStore } from "@/stores/use-board-store";
import { useDisplayStore } from "@/stores/use-display-store";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import { sendAnswerDrafts } from "@/api/answer-drafts";
import { storedRowId } from "@/test/stored-id";

/** What the user reads after a Send that skipped a draft, in real English. */

vi.mock("@/api/answer-drafts", () => ({ saveAnswerDraft: vi.fn(), clearAnswerDraft: vi.fn(), sendAnswerDrafts: vi.fn() }));
vi.mock("@/api/agents", () => ({ fetchAgents: vi.fn(() => Promise.resolve({ agents: [], accounts: [] })), onAgentsChanged: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.mock("@/api/board", () => ({ onBoardChanged: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.mock("@/api/gesture", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/gesture")>()),
  withGesture: (_name: string, run: () => Promise<unknown>) => run(),
}));

function Screen() {
  const toast = useMindmapStore((s) => s.pendingToast);
  const clear = useMindmapStore((s) => s.clearToast);
  return (
    <div>
      <AgentStatus />
      <AnchoredToast toast={toast} onDismiss={clear} />
    </div>
  );
}

/** Opens the agent status menu and presses its Send line. */
function sendFromMenu(): void {
  fireEvent.click(screen.getByRole("button", { name: /Click for details/ }));
  fireEvent.click(screen.getByRole("menuitem", { name: /Send: 2 staged answers/ }));
}

beforeEach(() => {
  vi.clearAllMocks();
  useMindmapStore.getState().clearToast();
  useDisplayStore.setState({ showAgentStatus: true });
  useAgentActivityStore.setState({ stagedWaitIds: [storedRowId(3), storedRowId(4)] });
  useBoardStore.setState({ settle: () => Promise.resolve() });
});

describe("the toast of a send that skipped drafts", () => {
  it("names each skipped wait by its title and why, in one toast", async () => {
    vi.mocked(sendAnswerDrafts).mockResolvedValue({
      sent: [{ wait_id: storedRowId(3), task_id: storedRowId(1) }],
      skipped: [
        { wait_id: storedRowId(4), task_id: storedRowId(1), title: "Colour?", reason: "released" },
        { wait_id: storedRowId(5), task_id: null, title: null, reason: "gone" },
      ],
    });
    render(<Screen />);

    sendFromMenu();

    await waitFor(() => expect(screen.getByText(/Not sent: Colour\? \(already answered\); an answer \(gone\)/)).toBeInTheDocument());
  });

  it("says nothing when every draft went out", async () => {
    vi.mocked(sendAnswerDrafts).mockResolvedValue({ sent: [], skipped: [] });
    render(<Screen />);

    sendFromMenu();

    await waitFor(() => expect(sendAnswerDrafts).toHaveBeenCalled());
    expect(screen.queryByText(/Not sent/)).not.toBeInTheDocument();
  });

  it("says a refused send and changes nothing", async () => {
    vi.mocked(sendAnswerDrafts).mockRejectedValue(new Error("the wait is gone"));
    render(<Screen />);

    sendFromMenu();

    await waitFor(() => expect(screen.getByText(/Couldn't change the expectation/)).toBeInTheDocument());
  });
});
