import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listDomains, DOMAIN_SUBTYPE } from "@/api/domains";
import type { Domain } from "@/api/domains";
import { useFilterStore } from "@/stores/use-filter-store";
import type { StatusMode, TagFilterMode } from "@/utils/filter-tree";
import styles from "./FilterPopover.module.css";

const STATUS_MODES: StatusMode[] = ["all", "plan", "start", "do"];
const NEXT_TAG_MODE: Record<TagFilterMode, TagFilterMode> = { any: "all", all: "exclude", exclude: "any" };

/** The filter panel opened from the top-bar Filter button: status preset, tag filters, type toggles. */
export default function FilterPopover() {
  const { t } = useTranslation(["filter", "nodeKinds"]);
  const filter = useFilterStore((s) => s.filter);
  const setStatusMode = useFilterStore((s) => s.setStatusMode);
  const toggleModeFlows = useFilterStore((s) => s.toggleModeFlows);
  const addTagFilter = useFilterStore((s) => s.addTagFilter);
  const setTagFilterMode = useFilterStore((s) => s.setTagFilterMode);
  const removeTagFilter = useFilterStore((s) => s.removeTagFilter);
  const toggleShowInfo = useFilterStore((s) => s.toggleShowInfo);
  const toggleShowFlow = useFilterStore((s) => s.toggleShowFlow);
  const reset = useFilterStore((s) => s.reset);

  const [tags, setTags] = useState<Domain[]>([]);
  useEffect(() => { void listDomains(DOMAIN_SUBTYPE.TAG).then(setTags); }, []);

  const tagName = (id: number) => tags.find((tag) => tag.id === id)?.title ?? `#${id}`;
  const selected = new Set(filter.tagFilters.map((tf) => tf.tagId));
  const available = tags.filter((tag) => tag.title.trim() !== "" && !selected.has(tag.id));
  const showFlowsSub = filter.statusMode === "plan" || filter.statusMode === "start";

  return (
    <div className={styles.popover}>
      <section className={styles.section}>
        <div className={styles.sectionLabel}>{t("statusLabel")}</div>
        <div className={styles.segmented}>
          {STATUS_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              className={`${styles.seg}${filter.statusMode === mode ? ` ${styles.segActive}` : ""}`}
              onClick={() => setStatusMode(mode)}
            >
              {t(`mode.${mode}`)}
            </button>
          ))}
        </div>
        {showFlowsSub && (
          <label className={styles.check}>
            <input type="checkbox" checked={filter.modeIncludeFlows} onChange={toggleModeFlows} />
            {t("includeFlows")}
          </label>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionLabel}>{t("tagsLabel")}</div>
        {filter.tagFilters.map((tf) => (
          <div key={tf.tagId} className={styles.tagRow}>
            <button type="button" className={`${styles.modeBtn} ${styles[`mode_${tf.mode}`]}`} onClick={() => setTagFilterMode(tf.tagId, NEXT_TAG_MODE[tf.mode])}>
              {t(`tagMode.${tf.mode}`)}
            </button>
            <span className={styles.tagName}>{tagName(tf.tagId)}</span>
            <button type="button" className={styles.removeBtn} aria-label={t("removeTagFilter")} onClick={() => removeTagFilter(tf.tagId)}>×</button>
          </div>
        ))}
        {available.length > 0 && (
          <select
            className={styles.addSelect}
            value=""
            onChange={(e) => { if (e.target.value !== "") addTagFilter(Number(e.target.value)); }}
          >
            <option value="">{t("addTag")}</option>
            {available.map((tag) => <option key={tag.id} value={tag.id}>{tag.title}</option>)}
          </select>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionLabel}>{t("typesLabel")}</div>
        <label className={styles.check}>
          <input type="checkbox" checked={filter.showInfo} onChange={toggleShowInfo} />
          {t("nodeKinds:info")}
        </label>
        <label className={styles.check}>
          <input type="checkbox" checked={filter.showFlow} onChange={toggleShowFlow} />
          {t("nodeKinds:flow")}
        </label>
      </section>

      <button type="button" className={styles.reset} onClick={reset}>{t("reset")}</button>
    </div>
  );
}
