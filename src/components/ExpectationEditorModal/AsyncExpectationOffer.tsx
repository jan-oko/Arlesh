import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import type { Domain } from "@/api/domains";
import type { useAsyncExpectationOffer } from "@/hooks/use-async-expectation-offer";
import ExpectationEditorModal from "./ExpectationEditorModal";

interface Props {
  /** The view's wait editor — `useAsyncExpectationOffer`, called by the view so its keys can open it. */
  waitEditor: ReturnType<typeof useAsyncExpectationOffer>;
  /** The tags to pick from, for the create paths. */
  allTags?: Domain[];
  domainNames?: Map<number, string>;
}

/** A blank wait for the create path: pending, live, no check-by. */
const BLANK_EXPECTATION: MindmapNode = {
  id: "new-expectation", kind: "expectation", title: "", status: "pending", checkBy: null, timeScope: null,
  position: 0, tagIds: [], children: [],
};

/**
 * The new-Expectation editor: for the wait `Shift+W` binds to a Task, for a wait `Shift+E` creates
 * in the List View, and for the two Asynchronous offers behind their settings. Nothing is drawn
 * until one of those happens; Cancel declines, and nothing is written.
 */
export default function AsyncExpectationOffer({ waitEditor, allTags, domainNames }: Props) {
  const { t } = useTranslation(["expectation", "undo"]);
  const { offer, dismiss, save } = waitEditor;
  if (offer === null) return null;
  const heading = offer.reason === "done"
    ? t("expectation:asyncDoneHeading", { title: offer.taskTitle })
    : t("expectation:newHeading");
  const lead = offer.reason === "done" ? t("expectation:asyncDoneLead")
    : offer.reason === "create" ? undefined
      : t("expectation:asyncLead", { title: offer.taskTitle });
  return (
    <ExpectationEditorModal
      key={`${offer.taskId}-${offer.reason}`}
      node={BLANK_EXPECTATION}
      heading={heading}
      {...(lead !== undefined ? { lead } : {})}
      {...(allTags !== undefined ? { allTags } : {})}
      {...(domainNames !== undefined ? { domainNames } : {})}
      onSave={(data) => save(t("undo:gestures.nameWait"), data)}
      onClose={dismiss}
    />
  );
}
