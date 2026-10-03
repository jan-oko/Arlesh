import { useTranslation } from "react-i18next";
import type { FirstCheck } from "@/api/flows";
import { SCOPE_ORDER } from "@/utils/flow-cycle";
import styles from "@/components/EditorModal/EditorModal.module.css";

const KIND_LABEL = {
  season: "kindSeason",
  month: "kindMonth",
  week: "kindWeek",
  day: "kindDay",
  part_of_day: "kindPart",
} as const satisfies Record<(typeof SCOPE_ORDER)[number], string>;

interface Props {
  value: FirstCheck | null;
  onChange: (value: FirstCheck | null) => void;
  /** The Flow Window's kind: a first check is counted in it or in a finer unit. */
  flowScopeKind: string | null;
}

/**
 * When a wait item's occurrences are first checked on: the start of the Nth unit of a kind, counted
 * from each occurrence's window start — the relative form a Cycle Plan takes, since a template has
 * no dates. Empty is the window's start. The Check every repeats from there.
 */
export default function FirstCheckField({ value, onChange, flowScopeKind }: Props) {
  const { t } = useTranslation("editor");
  const from = SCOPE_ORDER.findIndex((kind) => kind === flowScopeKind);
  const kinds = from === -1 ? SCOPE_ORDER.slice(3) : SCOPE_ORDER.slice(from);
  const kind = value?.kind ?? kinds[0] ?? "day";

  function setIndex(raw: string): void {
    const index = parseInt(raw, 10);
    onChange(Number.isNaN(index) || index < 1 ? null : { kind, index });
  }

  return (
    <div>
      <div className={styles.statusPills}>
        <input
          className={styles.input}
          type="number"
          min={1}
          value={value?.index ?? ""}
          placeholder={t("firstCheckAtStart")}
          aria-label={t("fieldFirstCheck")}
          onChange={(e) => setIndex(e.target.value)}
        />
        {kinds.map((option) => (
          <button
            key={option}
            type="button"
            disabled={value === null}
            className={`${styles.statusPill}${kind === option ? ` ${styles.statusPillActive}` : ""}`}
            onClick={() => onChange(value === null ? null : { kind: option, index: value.index })}
          >
            {t(KIND_LABEL[option])}
          </button>
        ))}
      </div>
      <small>{t("firstCheckHint")}</small>
    </div>
  );
}
