import { useTranslation } from "react-i18next";
import type { MindmapNode } from "@/utils/tree-layout";
import type { Domain } from "@/api/domains";
import type { useWaitEditor } from "@/hooks/use-wait-editor";
import { defaultTemplate } from "@/hooks/use-wait-editor";
import ExpectationEditorModal from "./ExpectationEditorModal";
import AsyncTemplateEditorModal from "@/components/AsyncTemplateEditor/AsyncTemplateEditorModal";

interface Props {
  /** The view's wait editors — `useWaitEditor`, called by the view so its keys can open them. */
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
 * The editors `Shift+W` (a Task's Expectation template) and `Shift+E` (a new stored Expectation)
 * open. Nothing is drawn until one of those happens; Cancel declines, and nothing is written.
 */
export default function WaitEditors({ waitEditor, allTags, domainNames }: Props) {
  const { t } = useTranslation(["expectation", "undo"]);
  const { create, template, dismiss, saveCreate, saveTemplate } = waitEditor;
  if (template !== null) {
    return (
      <AsyncTemplateEditorModal
        key={template.taskId}
        taskTitle={template.taskTitle}
        template={template.template
          ?? defaultTemplate(template.taskTitle, (title) => t("expectation:templateDefaultTitle", { title }))}
        hasTemplate={template.template !== null}
        allTags={allTags}
        domainNames={domainNames}
        onSave={(next) => saveTemplate(t("undo:gestures.editTemplate"), next)}
        onClose={dismiss}
      />
    );
  }
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
