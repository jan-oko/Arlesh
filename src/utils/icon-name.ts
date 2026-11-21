/** The attributes that keep an icon-only control named: an `aria-label` and a hover title (no keyboard chord on a touchscreen). */
export function iconName(touch: boolean, label: string, title: string | undefined): { "aria-label"?: string; title?: string } {
  if (!touch) return title === undefined ? {} : { title };
  return { "aria-label": label, title: label };
}
