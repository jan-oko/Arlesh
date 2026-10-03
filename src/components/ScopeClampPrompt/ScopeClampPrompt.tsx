import { useTranslation } from "react-i18next";
import WarningConfirmModal from "@/components/WarningConfirmModal/WarningConfirmModal";
import { useScopeClampStore } from "@/stores/use-scope-clamp-store";

/**
 * The clamp-or-cancel prompt for Time Scopes, mounted once at the root: names the descendants a
 * narrowed window or a reparent would orphan — with the flow each came from — and offers to clamp
 * them to the new window, or cancel.
 */
export default function ScopeClampPrompt() {
  const { t } = useTranslation(["warnings", "nodeKinds"]);
  const request = useScopeClampStore((s) => s.request);
  const answer = useScopeClampStore((s) => s.answer);
  if (request === null) return null;
  return (
    <WarningConfirmModal
      heading={t("warnings:scopeClampHeading", { count: request.conflicts.length })}
      consequences={request.conflicts.map((c) => {
        const item = t("warnings:scopeClampItem", {
          type: c.node_type === "goal" ? t("nodeKinds:goal") : t("nodeKinds:task"),
          id: c.node_id,
        });
        const flow = request.flowOrigins[`${c.node_type}-${c.node_id}`];
        return flow !== undefined ? t("warnings:scopeClampFromFlow", { item, flow }) : item;
      })}
      actions={[{ label: t("warnings:scopeClampAction"), variant: "primary", onClick: () => answer(true) }]}
      onCancel={() => answer(false)}
    />
  );
}
