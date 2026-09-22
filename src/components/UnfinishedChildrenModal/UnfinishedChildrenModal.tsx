import { useTranslation } from "react-i18next";
import WarningConfirmModal from "@/components/WarningConfirmModal/WarningConfirmModal";
import { WARNING_VARIANT } from "@/components/WarningConfirmModal/warning-confirm";
import type { OccurrencePrompt } from "@/hooks/use-occurrence-completion";

interface Props {
  prompt: OccurrencePrompt;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The prompt raised when marking a Habit occurrence done while it still holds unfinished children.
 *
 * It names each one rather than counting them, because a confirmation the user can only accept
 * blind is not consent — the point is seeing what is about to be closed over. Confirming marks the
 * occurrence done and leaves the children where they are; cancelling writes nothing at all.
 */
export default function UnfinishedChildrenModal({ prompt, onConfirm, onCancel }: Props) {
  const { t } = useTranslation(["warnings", "nodeKinds"]);
  return (
    <WarningConfirmModal
      heading={t("warnings:occurrenceUnfinishedHeading", {
        title: prompt.title,
        count: prompt.children.length,
      })}
      consequences={prompt.children.map((child) =>
        t("warnings:occurrenceUnfinishedItem", {
          type: t(`nodeKinds:${child.child_type}`),
          title: child.title,
        }),
      )}
      actions={[
        {
          label: t("warnings:occurrenceUnfinishedAction"),
          variant: WARNING_VARIANT.PRIMARY,
          onClick: onConfirm,
        },
      ]}
      onCancel={onCancel}
    />
  );
}
