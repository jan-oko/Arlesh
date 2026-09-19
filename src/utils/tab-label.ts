/** The two labels a tab carries: the one it was given and the one it derives from where it is. */
export interface TabLabels {
  /** The subtree root's title, maintained by `use-tab-title`; `null` at the whole tree. */
  title: string | null;
  /** The name the user gave the tab; `null` when it has none. */
  customTitle: string | null;
}

/**
 * What the strip shows on a tab.
 *
 * A name the user gave wins, and nothing maintains it but the user. Underneath it the derived label
 * carries on being rewritten as the tab is navigated, so taking the name off reveals a label that is
 * already right rather than a stale one — which is the whole reason the two are separate fields.
 */
export function tabLabel({ title, customTitle }: TabLabels, wholeTreeLabel: string): string {
  return customTitle ?? title ?? wholeTreeLabel;
}
