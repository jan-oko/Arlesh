import { useTranslation } from "react-i18next";
import WarningConfirmModal from "@/components/WarningConfirmModal/WarningConfirmModal";
import { usePlanClampStore } from "@/stores/use-plan-clamp-store";

/**
 * The clamp-or-cancel prompt for Plans, mounted once at the root: names the Tasks a new Plan above
 * them would leave planned outside it, and offers to clamp their Plans into it, clear them so they
 * inherit it, or cancel.
 */
export default function PlanClampPrompt() {
  const { t } = useTranslation("warnings");
  const request = usePlanClampStore((s) => s.request);
  const answer = usePlanClampStore((s) => s.answer);
  if (request === null) return null;
  return (
    <WarningConfirmModal
      heading={t("planClampHeading", { count: request.conflicts.length })}
      consequences={request.conflicts.map((conflict) => t("planClampItem", { title: conflict.title }))}
      actions={[
        { label: t("planClampAction"), variant: "primary", onClick: () => answer("clamp") },
        { label: t("planClearAction"), variant: "primary", onClick: () => answer("clear") },
      ]}
      onCancel={() => answer(null)}
    />
  );
}
