import type { TabState } from "@/stores/tab-stores";
import type { Tab } from "@/stores/use-tabs-store";
import { useTabsStore } from "@/stores/use-tabs-store";
import { freshTabState } from "@/stores/tab-persistence";
import { DEFAULT_LIST_FILTER } from "@/utils/list-filter";

/**
 * How a notification's List View on the Review preset reaches the screen: as a tab of its own (the
 * desktop), or in place of what the one view was showing (the phone, which has no tab strip to
 * grow).
 */
export type ReviewOpening = "tab" | "replace-view";

/** A tab that is the whole board's List View on the Review preset. */
function isReviewList(tab: Tab): boolean {
  const { view, listFilter, mindmap } = tab.stores;
  return view.getState().view === "list"
    && listFilter.getState().filter.preset === "review"
    && mindmap.getState().subtreeRootId === null;
}

function reviewListState(): TabState {
  const fresh = freshTabState();
  return { ...fresh, view: { ...fresh.view, view: "list" }, listFilter: { ...DEFAULT_LIST_FILTER, preset: "review" } };
}

/** Shows a List tab on the Review preset: the one already open, or a new tab after the active one. */
function showReviewTab(): Tab["stores"] {
  const strip = useTabsStore.getState();
  const open = strip.tabs.find(isReviewList);
  if (open !== undefined) {
    strip.activateTab(open.id);
    return open.stores;
  }
  const id = strip.openTab(reviewListState());
  const created = useTabsStore.getState().tabs.find((tab) => tab.id === id);
  if (created === undefined) throw new Error("A tab that was just opened is not in the strip");
  return created.stores;
}

/** Turns the active tab into the List View on the Review preset, over the whole board. */
function replaceActiveView(): Tab["stores"] {
  const { tabs, activeTabId } = useTabsStore.getState();
  const active = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  if (active === undefined) throw new Error("The tab strip is empty, which cannot happen");
  active.stores.view.getState().setView("list");
  active.stores.listFilter.getState().setPreset("review");
  active.stores.mindmap.getState().exitToRoot();
  return active.stores;
}

/** What a notification of an agent's question names: the Task holding it, and the wait itself. */
export interface NotifiedQuestion {
  task: string | null;
  wait: string | null;
}

/**
 * Opens the List View on the Review preset for a clicked or tapped notification of an agent's
 * question: the Task's row is selected and the wait's own answer box is scrolled into view, and on
 * the desktop focused as `Q` would (on the phone it is not, so the keyboard does not rise on
 * opening). A question already answered or gone is simply not drawn: the list still opens, the
 * Task selected if it is still a row and no box focused.
 */
export function openReviewList(question: NotifiedQuestion, opening: ReviewOpening): void {
  const stores = opening === "tab" ? showReviewTab() : replaceActiveView();
  if (question.task === null) return;
  const wait = question.wait === null ? undefined : { id: question.wait, focus: opening === "tab" };
  stores.mindmap.getState().requestSelection(question.task, wait);
}
