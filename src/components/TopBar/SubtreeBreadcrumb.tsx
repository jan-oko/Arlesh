import { Fragment, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import type { SubtreeCrumb } from "@/stores/use-mindmap-store";
import { useCrumbOverflow } from "@/hooks/use-crumb-overflow";
import FoldedCrumbsMenu from "./FoldedCrumbsMenu";
import styles from "./SubtreeBreadcrumb.module.css";

const FOLD_ICON = "…";

/** A subtree glyph — a parent branching down to two children — marking the chain as where you are. */
function SubtreeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="5" rx="1" />
      <rect x="2" y="17" width="6" height="5" rx="1" />
      <rect x="16" y="17" width="6" height="5" rx="1" />
      <path d="M12 7v4M5 17v-2h14v2" />
    </svg>
  );
}

/**
 * Identifies the chain on screen, titles included: a rename changes how much room it needs.
 *
 * Two different chains spelling the same key would only cost a stale fold count until the next
 * measurement, so the separator does not have to be one no title can contain.
 */
function chainIdentity(ancestors: readonly SubtreeCrumb[], currentTitle: string): string {
  return [...ancestors.map((crumb) => `${crumb.id ?? ""}:${crumb.title}`), currentTitle].join(" | ");
}

/**
 * Where you are, as the whole way down to it: `Arlesh › CODE › ARLESH › Features`.
 *
 * Every ancestor segment is a button that exits to that level, so the middle of a deep chain is one
 * click away rather than unreachable; the first segment is the true root and the last is where you
 * are, plain text, since "here" has nowhere to navigate to. Shown only inside a subtree — at the
 * true root the bar carries nothing, because there is no chain to name.
 *
 * It reads the active tab's store and derives nothing of its own: `use-subtree-nav` publishes the
 * chain from whichever view is mounted, and the exits are that store's own `exitSubtree` /
 * `exitToRoot`, the same two the `Shift`/`Ctrl+Escape` bindings call.
 *
 * When the chain outgrows the bar its middle folds into a `…` whose menu still reaches every level
 * it dropped. The first and last segments never fold: between them they say which board you are on
 * and which subtree you are in, which is the least a breadcrumb can be and still be one.
 */
export default function SubtreeBreadcrumb() {
  const { t } = useTranslation("common");
  const subtreeNav = useMindmapStore((s) => s.subtreeNav);
  const exitSubtree = useMindmapStore((s) => s.exitSubtree);
  const exitToRoot = useMindmapStore((s) => s.exitToRoot);
  const chainRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const ancestors = subtreeNav?.ancestors ?? [];
  const currentTitle = subtreeNav?.currentTitle ?? "";
  const [rootCrumb, ...middles] = ancestors;
  const folded = useCrumbOverflow(chainRef, middles.length, chainIdentity(ancestors, currentTitle));
  const foldedCrumbs = middles.slice(0, folded);
  const shownCrumbs = middles.slice(folded);

  // Nothing at the true root, and nothing while a view is still resolving the chain: a breadcrumb
  // with no root to open it would be a path starting mid-air.
  if (subtreeNav === null || rootCrumb === undefined) return null;

  function goTo(crumb: SubtreeCrumb) {
    if (crumb.id === null) {
      exitToRoot();
      return;
    }
    exitSubtree(crumb.id);
  }

  return (
    <nav className={styles.wrap}>
      {/* Spelled out for a screen reader, which would otherwise hear a run of bare titles. */}
      <span className={styles.srOnly}>{t("insideSubtree")}</span>
      <div className={styles.chain} ref={chainRef}>
        <span className={styles.icon}><SubtreeIcon /></span>
        <button
          type="button"
          className={styles.segment}
          dir="auto"
          title={t("exitToLevel")}
          onClick={() => goTo(rootCrumb)}
        >
          {rootCrumb.title}
        </button>
        {foldedCrumbs.length > 0 && (
          <>
            <span className={styles.separator} aria-hidden="true" />
            <button
              type="button"
              className={`${styles.segment} ${styles.fold}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={t("foldedLevels")}
              onClick={() => setMenuOpen((open) => !open)}
            >
              {FOLD_ICON}
            </button>
          </>
        )}
        {shownCrumbs.map((crumb) => (
          <Fragment key={crumb.id ?? "root"}>
            <span className={styles.separator} aria-hidden="true" />
            <button
              type="button"
              className={styles.segment}
              dir="auto"
              title={t("exitToLevel")}
              onClick={() => goTo(crumb)}
            >
              {crumb.title}
            </button>
          </Fragment>
        ))}
        <span className={styles.separator} aria-hidden="true" />
        <span className={styles.current} dir="auto">{currentTitle}</span>
      </div>
      {/* A chain that has grown room again folds nothing — and then there is no menu to show, even
          if one was open when the last segment came back. */}
      {menuOpen && foldedCrumbs.length > 0 && (
        <FoldedCrumbsMenu
          crumbs={foldedCrumbs}
          onSelect={goTo}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </nav>
  );
}
