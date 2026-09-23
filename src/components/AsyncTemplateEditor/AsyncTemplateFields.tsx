import { useTranslation } from "react-i18next";
import type { AsyncTemplate } from "@/api/tasks";
import type { DurationSpec } from "@/api/time-scope";
import type { Domain } from "@/api/domains";
import CountedDurationField from "@/components/EditorModal/CountedDurationField";
import TagPicker from "@/components/TagPicker/TagPicker";
import styles from "@/components/EditorModal/EditorModal.module.css";

interface Props {
  value: AsyncTemplate;
  onChange: (value: AsyncTemplate) => void;
  /** The tags to pick from. Omitted, the template's tags are kept as they are and not drawn. */
  allTags?: Domain[] | undefined;
  domainNames?: Map<number, string> | undefined;
}

/** Writes `value` into `field`, or drops the field when there is none — the template's optional
 * parts are absent rather than null on the wire. */
function withDuration(template: AsyncTemplate, field: "time_scope" | "check_every", value: DurationSpec | null): AsyncTemplate {
  const next: AsyncTemplate = { ...template };
  if (value === null) delete next[field];
  else next[field] = value;
  return next;
}

/**
 * The fields of a Task's **Expectation template** — what the wait its completion spawns will be:
 * a title, a Time Scope **rule** (N days, weeks… counted from the day the wait begins), how often
 * to check on it, and its tags. No status: a template is never pending or released, only the wait
 * drawn from it is. Shared by the Task editor and the `Shift+W` editor.
 */
export default function AsyncTemplateFields({ value, onChange, allTags, domainNames }: Props) {
  const { t } = useTranslation(["expectation", "editor"]);
  return (
    <>
      <label className={styles.label}>
        {t("expectation:templateTitle")}
        <input
          className={styles.input}
          type="text"
          value={value.title}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
        />
      </label>
      <div className={styles.label}>
        {t("expectation:templateTimeScope")}
        <CountedDurationField
          value={value.time_scope ?? null}
          onChange={(next) => onChange(withDuration(value, "time_scope", next))}
          label={t("expectation:templateTimeScope")}
          emptyLabel={t("expectation:templateTimeScopeNone")}
        />
      </div>
      <div className={styles.label}>
        {t("expectation:fieldCheckEvery")}
        <CountedDurationField
          value={value.check_every ?? null}
          onChange={(next) => onChange(withDuration(value, "check_every", next))}
          label={t("expectation:fieldCheckEvery")}
          emptyLabel={t("expectation:checkEveryNone")}
        />
      </div>
      {allTags !== undefined && domainNames !== undefined && (
        <TagPicker
          allTags={allTags}
          domainNames={domainNames}
          selectedIds={value.tag_ids}
          onChange={(tagIds) => onChange({ ...value, tag_ids: tagIds })}
        />
      )}
    </>
  );
}
