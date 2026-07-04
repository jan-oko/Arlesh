import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { listDomains, DOMAIN_SUBTYPE } from "@/api/domains";
import type { Domain } from "@/api/domains";
import { useFilterStore } from "@/stores/use-filter-store";
import type { StatusMode, TagFilterMode } from "@/utils/filter-tree";
import styles from "./FilterPopover.module.css";

const STATUS_MODES: StatusMode[] = ["all", "plan", "start", "do"];
const NEXT_TAG_MODE: Record<TagFilterMode, TagFilterMode> = { any: "all", all: "exclude", exclude: "any" };
/** Set-theory glyphs: Any = union, All = intersection, Exclude = empty set. */
const MODE_SYMBOL: Record<TagFilterMode, string> = { any: "∪", all: "∩", exclude: "∅" };

/** Faded background from a #rrggbb aspect colour (ignored for other formats). */
function fade(color: string | null): string | undefined {
  return color !== null && /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}22` : undefined;
}

/** Searchable, portalled tag picker that adds a tag filter on select (so it isn't clipped by the popover). */
function TagAdder({ available, colorOf, onAdd }: { available: Domain[]; colorOf: (id: number) => string | null; onAdd: (id: number) => void }) {
  const { t } = useTranslation("filter");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const el = inputRef.current;
      if (el === null) return;
      const r = el.getBoundingClientRect();
      setPos({ top: r.bottom, left: r.left, width: r.width });
    };
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const results = available.filter((tag) => tag.title.toLowerCase().includes(q)).slice(0, 30);

  return (
    <div className={styles.searchWrap}>
      <input
        ref={inputRef}
        type="text"
        className={styles.search}
        placeholder={t("addTag")}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      />
      {open && results.length > 0 && pos !== null && createPortal(
        <div className={styles.menu} style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width }}>
          {results.map((tag) => {
            const color = colorOf(tag.id);
            return (
              <div key={tag.id} className={styles.menuItem} onMouseDown={(e) => { e.preventDefault(); onAdd(tag.id); setQuery(""); }}>
                {color !== null && <span className={styles.dot} style={{ background: color }} />}
                {tag.title}
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

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

  // Load all domains so each tag's *aspect* colour can be resolved by walking up to the nearest coloured ancestor.
  const [domains, setDomains] = useState<Domain[]>([]);
  useEffect(() => { void listDomains().then(setDomains); }, []);
  const byId = useMemo(() => new Map(domains.map((d) => [d.id, d])), [domains]);
  const tags = useMemo(() => domains.filter((d) => d.subtype === DOMAIN_SUBTYPE.TAG), [domains]);

  const tagName = (id: number) => tags.find((tag) => tag.id === id)?.title ?? `#${id}`;
  const colorOf = (id: number): string | null => {
    const seen = new Set<number>();
    let cur = byId.get(id);
    while (cur !== undefined && !seen.has(cur.id)) {
      if (cur.color !== null) return cur.color;
      seen.add(cur.id);
      cur = cur.parent_id !== null ? byId.get(cur.parent_id) : undefined;
    }
    return null;
  };
  const selected = useMemo(() => new Set(filter.tagFilters.map((tf) => tf.tagId)), [filter.tagFilters]);
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
        {filter.tagFilters.length > 0 && (
          <div className={styles.tagPills}>
            {filter.tagFilters.map((tf) => {
              const color = colorOf(tf.tagId);
              return (
                <span key={tf.tagId} className={styles.tagPill} style={{ borderColor: color ?? undefined, background: fade(color) }}>
                  <button
                    type="button"
                    className={`${styles.modeGlyph} ${styles[`mode_${tf.mode}`]}`}
                    title={t(`tagMode.${tf.mode}`)}
                    aria-label={t(`tagMode.${tf.mode}`)}
                    onClick={() => setTagFilterMode(tf.tagId, NEXT_TAG_MODE[tf.mode])}
                  >
                    {MODE_SYMBOL[tf.mode]}
                  </button>
                  <span className={styles.tagPillName}>{tagName(tf.tagId)}</span>
                  <button type="button" className={styles.tagPillX} aria-label={t("removeTagFilter")} onClick={() => removeTagFilter(tf.tagId)}>×</button>
                </span>
              );
            })}
          </div>
        )}
        {available.length > 0 && <TagAdder available={available} colorOf={colorOf} onAdd={addTagFilter} />}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionLabel}>{t("typesLabel")}</div>
        <div className={styles.typePills}>
          <button type="button" className={`${styles.typePill}${filter.showInfo ? ` ${styles.typePillActive}` : ""}`} onClick={toggleShowInfo}>
            {t("nodeKinds:info")}
          </button>
          <button type="button" className={`${styles.typePill}${filter.showFlow ? ` ${styles.typePillActive}` : ""}`} onClick={toggleShowFlow}>
            {t("nodeKinds:flow")}
          </button>
        </div>
      </section>

      <button type="button" className={styles.reset} onClick={reset}>{t("reset")}</button>
    </div>
  );
}
