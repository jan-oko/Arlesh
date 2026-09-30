import { useTranslation } from "react-i18next";

interface Props {
  /** The id the item's `aria-describedby` names. */
  id: string;
  /** Drawn inside an SVG node (the Mindmap), where it is a `<desc>` rather than a hidden span. */
  svg?: boolean;
}

/**
 * The words behind an Overdue item's amber border. The border is the only thing on screen that says
 * an item is Overdue — the badge that also said so was removed — so every surface that draws the
 * border names it here too, and points its item's `aria-describedby` at it: colour alone reaches no
 * one who cannot see it. Hidden from sight, never from the accessibility tree's description.
 */
export default function OverdueNote({ id, svg = false }: Props) {
  const { t } = useTranslation("statusIcons");
  if (svg) return <desc id={id}>{t("overdue")}</desc>;
  return <span id={id} hidden>{t("overdue")}</span>;
}
