import { useTranslation } from "react-i18next";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import type { PresetChoice } from "@/hooks/use-preset-choice";
import styles from "./PhoneTopBar.module.css";

/** Marks the preset in force; `aria-pressed` says the same to a screen reader. */
const ACTIVE_GLYPH = "●";

interface Props {
  choice: PresetChoice;
  onClose: () => void;
}

/** The preset chip's sheet: every preset the view offers, the active one marked. A view that locks
 * its preset draws the others disabled and says why, as the desktop dropdown does. */
export default function PresetSheet({ choice, onClose }: Props) {
  const { t } = useTranslation(["touch", "listView"]);
  return (
    <BottomSheet title={t("touch:presetSheetTitle")} onClose={onClose}>
      {choice.lockedReason !== null && <p className={styles.sheetNote}>{choice.lockedReason}</p>}
      <ul className={styles.sheetList}>
        {choice.options.map((preset) => (
          <li key={preset}>
            <button
              type="button"
              className={styles.sheetRow}
              aria-pressed={preset === choice.active}
              disabled={choice.lockedReason !== null && preset !== choice.active}
              onClick={() => { choice.select(preset); onClose(); }}
            >
              {t(`listView:preset.${preset}`)}
              {preset === choice.active && <span className={styles.check} aria-hidden="true">{ACTIVE_GLYPH}</span>}
            </button>
          </li>
        ))}
      </ul>
    </BottomSheet>
  );
}
