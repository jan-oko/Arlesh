import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import { useAsyncExpectationOffer } from "@/hooks/use-async-expectation-offer";
import ExpectationEditorModal from "./ExpectationEditorModal";

interface Props {
  tree: MindmapNode;
  reload: () => Promise<void>;
}

/** A blank wait for the create path: pending, live, no check-by. */
const BLANK_EXPECTATION: MindmapNode = {
  id: "new-expectation", kind: "expectation", title: "", status: "pending", checkBy: null,
  position: 0, tagIds: [], children: [],
};

/**
 * The new-Expectation editor an asynchronous Task asks for — when it is marked asynchronous, or
 * finished with nothing yet recorded as what it waits on — each behind its own setting. Nothing is
 * drawn until one of those happens; Cancel declines, and nothing is written.
 */
export default function AsyncExpectationOffer({ tree, reload }: Props) {
  const { t } = useTranslation(["expectation", "undo"]);
  const { offer, dismiss, save } = useAsyncExpectationOffer(tree, reload);
  if (offer === null) return null;
  const heading = offer.reason === "marked"
    ? t("expectation:newHeading")
    : t("expectation:asyncDoneHeading", { title: offer.taskTitle });
  const lead = offer.reason === "marked"
    ? t("expectation:asyncLead", { title: offer.taskTitle })
    : t("expectation:asyncDoneLead");
  return (
    <ExpectationEditorModal
      key={`${offer.taskId}-${offer.reason}`}
      node={BLANK_EXPECTATION}
      heading={heading}
      lead={lead}
      onSave={(data) => save(t("undo:gestures.nameWait"), data)}
      onClose={dismiss}
    />
  );
}
