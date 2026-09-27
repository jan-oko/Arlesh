import { Fragment, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMindmapStore } from "@/stores/use-mindmap-store";
import type { SubtreeCrumb } from "@/stores/use-mindmap-store";
import { useCrumbOverflow } from "@/hooks/use-crumb-overflow";
import { crumbFold, lastFoldStep } from "@/utils/crumb-fold";
import FoldedCrumbsMenu from "./FoldedCrumbsMenu";
import styles from "./SubtreeBreadcrumb.module.css";

const FOLD_ICON = "…";

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
 * When the chain outgrows the bar it gives up whole segments before it cuts any text, in the order
 * `crumbFold` sets out: the middle folds into a `…` whose menu still reaches every level it dropped,
 * then the root joins it (`… › here`), then — only for a title too long to stand beside the `…` —
 * the root comes back in its place (`root › …`), and last of all the current title truncates on its
 * own. Two cut titles side by side say less than one whole one next to a `…`.
 */
export default function SubtreeBreadcrumb() {
  const { t } = useTranslation("common");
  const subtreeNav = useMindmapStore((s) => s.subtreeNav);
  const exitSubtree = useMindmapStore((s) => s.exitSubtree);
  const exitToRoot = useMindmapStore((s) => s.exitToRoot);
  const foldRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuOffset, setMenuOffset] = useState(0);

  const ancestors = subtreeNav?.ancestors ?? [];
  const currentTitle = subtreeNav?.currentTitle ?? "";
  const [rootCrumb, ...middles] = ancestors;
  const { boxRef: chainRef, step } = useCrumbOverflow(
    lastFoldStep(middles.length),
    chainIdentity(ancestors, currentTitle),
  );
  const fold = crumbFold(step, middles.length);
  const foldedMiddles = middles.slice(0, fold.middlesFolded);
  const foldedCrumbs = fold.rootShown || rootCrumb === undefined ? foldedMiddles : [rootCrumb, ...foldedMiddles];
  const shownCrumbs = middles.slice(fold.middlesFolded);
  const foldShown = foldedCrumbs.length > 0 || !fold.currentShown;

  // Nothing at the true root, and nothing while a view is still resolving the chain: a breadcrumb
  // with no root to open it would be a path starting mid-air.
  if (subtreeNav === null || rootCrumb === undefined) return null;

  /**
   * The menu hangs under the `…` rather than under the breadcrumb's start edge, which are no longer
   * the same place: a centred chain begins part-way across its cell, and an offset measured at open
   * time is the only thing that knows where. `offsetLeft` is against `.wrap`, the nearest positioned
   * ancestor, and the bar's own direction is LTR like the rest of the app's chrome.
   */
  function toggleMenu() {
    setMenuOffset(foldRef.current?.offsetLeft ?? 0);
    setMenuOpen((open) => !open);
  }

  function goTo(crumb: SubtreeCrumb) {
    if (crumb.id === null) {
      exitToRoot();
      return;
    }
    exitSubtree(crumb.id);
  }

  // The label names the landmark itself, which is what a screen reader announces on the way in — so
  // the chain is heard as where you are rather than as a run of bare titles.
  return (
    <nav className={styles.wrap} aria-label={t("insideSubtree")}>
      <div className={styles.chain} ref={chainRef}>
        <div className={styles.row}>
          {fold.rootShown && (
            <button
              type="button"
              className={styles.segment}
              dir="auto"
              title={t("exitToLevel")}
              onClick={() => goTo(rootCrumb)}
            >
              {rootCrumb.title}
            </button>
          )}
          {foldShown && (
            <>
              {fold.rootShown && <span className={styles.separator} aria-hidden="true" />}
              <button
                type="button"
                className={`${styles.segment} ${styles.fold}`}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                aria-label={t("foldedLevels")}
                // With where you are folded away too, the `…` is the only place its title is left.
                {...(fold.currentShown ? {} : { title: currentTitle })}
                ref={foldRef}
                onClick={toggleMenu}
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
          {fold.currentShown && (
            <>
              <span className={styles.separator} aria-hidden="true" />
              <span
                className={fold.currentTruncates ? `${styles.current} ${styles.currentShrinks}` : styles.current}
                dir="auto"
              >
                {currentTitle}
              </span>
            </>
          )}
        </div>
      </div>
      {/* A chain that has grown room again folds nothing — and then there is no menu to show, even
          if one was open when the last segment came back. */}
      {menuOpen && foldedCrumbs.length > 0 && (
        <FoldedCrumbsMenu
          crumbs={foldedCrumbs}
          offset={menuOffset}
          onSelect={goTo}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </nav>
  );
}
