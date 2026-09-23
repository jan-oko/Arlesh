import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import type { Domain } from "@/api/domains";
import type { useWaitEditor } from "@/hooks/use-wait-editor";
import ExpectationEditorModal from "./ExpectationEditorModal";

interface Props {
  /** The view's wait editor — `useWaitEditor`, called by the view so its key can open it. */
  waitEditor: ReturnType<typeof useWaitEditor>;
  /** The tags to pick from. */
  allTags?: Domain[];
  domainNames?: Map<number, string>;
}

/** A blank wait for the create path: pending, live, never checked on. */
const BLANK_EXPECTATION: MindmapNode = {
  id: "new-expectation", kind: "expectation", title: "", status: "pending", checkEvery: null, timeScope: null,
  position: 0, tagIds: [], children: [],
};

/**
 * The editor `Shift+E` opens in the List View for a new stored Expectation. Nothing is drawn until
 * then; Cancel declines, and nothing is written.
 */
export default function WaitEditors({ waitEditor, allTags, domainNames }: Props) {
  const { t } = useTranslation(["expectation", "undo"]);
  const { create, dismiss, saveCreate } = waitEditor;
  if (create === null) return null;
  return (
    <ExpectationEditorModal
      key={`${create.parentType}-${create.parentId}`}
      node={BLANK_EXPECTATION}
      heading={t("expectation:newHeading")}
      {...(allTags !== undefined ? { allTags } : {})}
      {...(domainNames !== undefined ? { domainNames } : {})}
      onSave={(data) => saveCreate(t("undo:gestures.nameWait"), data)}
      onClose={dismiss}
    />
  );
}
