import { useTranslation } from "react-i18next";
import type { CommandLabel } from "@/stores/use-command-surface-store";

/** Reads a command's label in the words on screen, from whichever namespace holds it. */
export function useCommandLabel(): (label: CommandLabel) => string {
  const { t } = useTranslation(["hotkeys", "touch"]);
  return (label) => (label.namespace === "hotkeys" ? t(`hotkeys:${label.key}`) : t(`touch:${label.key}`));
}
