import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDisplayStore } from "@/stores/use-display-store";
import styles from "./HabitCollapseSetting.module.css";
import own from "./CheckTaskPrefixSetting.module.css";

/**
 * The prefix a wait's virtual check task is titled with — `{prefix}{wait title}`. App-wide, beside
 * the other display settings, and in every view: a check task reads the same wherever it is drawn.
 *
 * Kept as a local draft while typing and committed on blur or Enter, so the board is not redrawn
 * with every keystroke. **Default** puts back the translated default; an emptied field is a real
 * choice — no prefix at all.
 */
export default function CheckTaskPrefixSetting() {
  const { t } = useTranslation(["common", "expectation"]);
  const stored = useDisplayStore((s) => s.checkTaskPrefix);
  const setPrefix = useDisplayStore((s) => s.setCheckTaskPrefix);
  const [draft, setDraft] = useState<string | null>(null);
  const inputId = useId();
  const effective = stored ?? t("expectation:checkTaskPrefixDefault");

  function commit(text: string): void {
    setDraft(null);
    if (text !== effective) setPrefix(text);
  }

  return (
    <div className={styles.row}>
      <label htmlFor={inputId}>{t("common:checkTaskPrefix")}</label>
      <span className={styles.field}>
        <input
          id={inputId}
          className={own.input}
          type="text"
          value={draft ?? effective}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commit(e.currentTarget.value); }}
        />
        {stored !== null && (
          <button type="button" className={styles.unit} onClick={() => { setDraft(null); setPrefix(null); }}>
            {t("common:checkTaskPrefixReset")}
          </button>
        )}
      </span>
    </div>
  );
}
