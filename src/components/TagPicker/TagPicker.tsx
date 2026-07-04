import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Domain } from "@/api/domains";
import styles from "@/components/EditorModal/EditorModal.module.css";

interface Props {
  allTags: Domain[];
  /** Domain id → title, for sectioning tags under their parent domain. */
  domainNames: Map<number, string>;
  selectedIds: number[];
  onChange: (ids: number[]) => void;
}

const NO_PARENT = -1;

/**
 * Tag picker: chosen tags shown as removable pills, plus a search dropdown whose options are grouped
 * by parent domain. Selecting produces the full `tagIds` set (the editor still diffs on save).
 */
export default function TagPicker({ allTags, domainNames, selectedIds, onChange }: Props) {
  const { t } = useTranslation("editor");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const validTags = useMemo(() => allTags.filter((tag) => tag.title.trim() !== ""), [allTags]);
  const selected = validTags.filter((tag) => selectedIds.includes(tag.id));

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const available = validTags.filter(
      (tag) => !selectedIds.includes(tag.id) && tag.title.toLowerCase().includes(q),
    );
    const byParent = new Map<number, Domain[]>();
    for (const tag of available) {
      const key = tag.parent_id ?? NO_PARENT;
      const list = byParent.get(key);
      if (list === undefined) byParent.set(key, [tag]);
      else list.push(tag);
    }
    return [...byParent.entries()]
      .map(([parentId, tags]) => ({
        parentId,
        title: parentId === NO_PARENT ? t("ungroupedTags") : (domainNames.get(parentId) ?? t("ungroupedTags")),
        tags: [...tags].sort((a, b) => a.title.localeCompare(b.title)),
      }))
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [validTags, selectedIds, query, domainNames, t]);

  if (validTags.length === 0) return null;

  function add(id: number) { onChange([...selectedIds, id]); setQuery(""); }
  function remove(id: number) { onChange(selectedIds.filter((x) => x !== id)); }

  return (
    <div className={styles.label}>
      {t("fieldTags")}
      {selected.length > 0 && (
        <div className={styles.tagPills}>
          {selected.map((tag) => (
            <span key={tag.id} className={styles.tagPill}>
              {tag.color !== null && <span className={styles.tagDot} style={{ background: tag.color }} />}
              {tag.title}
              <button type="button" className={styles.tagPillRemove} aria-label={t("removeTag")} onClick={() => remove(tag.id)}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className={styles.depSearchWrap}>
        <input
          type="text"
          className={styles.depSearch}
          placeholder={t("placeholderTagSearch")}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
        />
        {open && sections.length > 0 && (
          <div className={styles.depResults}>
            {sections.map((section) => (
              <div key={section.parentId}>
                <div className={styles.tagSectionHeader}>{section.title}</div>
                {section.tags.map((tag) => (
                  <div key={tag.id} className={styles.depResult} onMouseDown={(e) => { e.preventDefault(); add(tag.id); }}>
                    <span>
                      {tag.color !== null && <span className={styles.tagDot} style={{ background: tag.color }} />}
                      {tag.title}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
