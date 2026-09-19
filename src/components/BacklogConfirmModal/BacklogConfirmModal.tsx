import { useTranslation } from "react-i18next";
import WarningConfirmModal from "@/components/WarningConfirmModal/WarningConfirmModal";
import { WARNING_VARIANT } from "@/components/WarningConfirmModal/warning-confirm";
import { useScopeRangeLabel } from "@/hooks/use-scope-range-label";
import type { BacklogPlanPrompt } from "@/hooks/use-task-backlog";

interface Props {
  prompt: BacklogPlanPrompt;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The prompt raised when backlogging a Task that still has a Plan.
 *
 * It names the week being given up — resolving the plan window's label asynchronously, and saying
 * so in general terms until it arrives — because a refusal the user can only accept blind is not
 * consent. Cancelling writes nothing: the task keeps its plan and stays out of the backlog.
 */
export default function BacklogConfirmModal({ prompt, onConfirm, onCancel }: Props) {
  const { t } = useTranslation("warnings");
  const planLabel = useScopeRangeLabel(prompt.plan);
  return (
    <WarningConfirmModal
      heading={t("backlogHeading", { title: prompt.title })}
      consequences={[
        planLabel !== null ? t("backlogHasPlan", { plan: planLabel }) : t("backlogHasPlanUnnamed"),
      ]}
      actions={[
        { label: t("backlogClearPlanAction"), variant: WARNING_VARIANT.PRIMARY, onClick: onConfirm },
      ]}
      onCancel={onCancel}
    />
  );
}
