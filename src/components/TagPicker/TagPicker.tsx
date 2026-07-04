import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
 * by parent domain. The dropdown is a **popover** (portalled to `document.body`, fixed-positioned to
 * the input) so it isn't clipped by the editor modal's scroll area.
 */
export default function TagPicker({ allTags, domainNames, selectedIds, onChange }: Props) {
  const { t } = useTranslation("editor");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the popover pinned under the input while it's open (through modal scroll / window resize).
  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const el = inputRef.current;
      if (el === null) return;
      const rect = el.getBoundingClientRect();
      setMenuPos({ top: rect.bottom, left: rect.left, width: rect.width });
    };
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

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
      <input
        ref={inputRef}
        type="text"
        className={styles.depSearch}
        placeholder={t("placeholderTagSearch")}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      />
      {open && sections.length > 0 && menuPos !== null && createPortal(
        <div
          className={styles.tagMenu}
          style={{ position: "fixed", top: menuPos.top, left: menuPos.left, width: menuPos.width }}
        >
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
        </div>,
        document.body,
      )}
    </div>
  );
}
