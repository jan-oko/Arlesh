# Per-tab state is a store instance per tab, not a keyed singleton

A tab owns its subtree root, its view, its branch orientation, both its filter sets, its selection,
its collapsed nodes and its pan/zoom. Each tab therefore holds **its own instances** of the view,
filter, list-filter, mindmap and pan-zoom stores, and a React provider supplies the active tab's
bundle to the tree below it. The hooks components already call (`useViewStore`, `useFilterStore`,
`useListFilterStore`, `useMindmapStore`) keep their signatures and resolve through that provider, so
component code never learns that tabs exist. The theme and the clipboard stay singletons.

## Status

accepted

## Context

Before tabs, every one of those stores was a module-level singleton — one subtree root, one view,
one filter set for the whole app. Tabs make each of them per tab, which is the single largest
change the feature carries: it touches the assumption, held in every view component, that state
comes from a module rather than from somewhere.

Two things constrain the answer. The stores are **read from roughly a dozen components** and, more
importantly, from hooks several levels down that have no idea which tab they are in — nothing is
threaded down as props today, and threading a tab id down would be the change. And the split
between what a tab owns and what the app owns is **hard to reverse**: it is baked into the
persisted shape, so getting it wrong once users have tabs open means a migration, not an edit.

## Considered options

- **Key the existing singletons by tab id** — `useFilterStore((s) => s.byTab[tabId])`. Rejected:
  every call site has to obtain and pass a tab id, which is the very plumbing the design is trying
  to avoid, and nothing stops a component reading the *wrong* tab's slice. The compiler cannot help;
  the bug shows up as one tab's filter quietly applying to another.

- **One `useTabsStore` holding an array of full tab states.** The simplest mental model, and the
  easiest to persist. Rejected: it merges four focused stores into one large one, against the
  project's one-store-per-domain convention, and every filter action grows a tab-id argument. The
  filter logic would stop being about filters.

- **Mount every tab's view and hide the inactive ones.** Would give per-tab component state for
  free, including pan/zoom. Rejected: each view loads the whole board, so *n* tabs would be *n*
  loads kept live and refreshed, and the cost grows with exactly the thing tabs are for.

- **A store instance per tab, resolved through context** — chosen.

## Consequences

- **The hook is the seam.** `tabStoreHook(pick)` builds each per-tab hook from the slot it occupies
  in the bundle. A component calls `useFilterStore((s) => s.filter)` exactly as before and gets the
  tab it is rendered in. The substitution is one file, not a dozen.

- **Tab isolation is structural, not disciplined.** Two tabs do not share a store object, so there
  is no code path by which one could write the other's state. The tests that matter assert exactly
  that, because leakage is the failure mode the design exists to rule out.

- **`getState` / `setState` address the *active* tab.** Both accessors resolve through the strip
  rather than through any provider, which is what keeps imperative readers — and every existing
  test — working unchanged. It also means they can disagree with a component pinned to a different
  tab's provider, which is deliberate and is how the isolation tests are written.

- **The clipboard had to leave `useMindmapStore`.** It lived there because the mindmap was the only
  thing that used it; per-tab stores made that accidental home load-bearing, and a per-tab clipboard
  would break the obvious reason for a second tab. It is now `use-clipboard-store`, app-wide.
  `pathHeaderIcons` left `useViewStore` for the same reason and became `use-display-store`: a
  display preference that silently reset per tab would read as a bug.

- **Persistence moved into one place.** Each store used to persist itself under its own key; the
  strip is now written down as a whole (`arlesh-tabs`), assembled from the live stores whenever a
  persisted field changes. That is one shape to migrate rather than four, and it is where the
  pre-tabs keys are read once and folded into the first tab. Nesting per-tab state is exactly the
  operation that walks into the rehydration trap `persist-merge.ts` exists for, so nothing is
  spread in wholesale: every field is rebuilt from the defaults on the way out of storage, and the
  List View's pill map gets its own rebuild on top.

- **Pan/zoom needed a store it never had.** It lived in refs inside `use-pan-zoom`, which was fine
  while a canvas belonged to the app. With the canvas staying mounted across a tab switch, the hook
  now restores from the tab's pan-zoom store on arrival and writes back on departure, keyed on the
  store's identity so the cleanup lands on the tab being left. Nothing subscribes to it, so panning
  still costs no renders.

- **A React context is carried for one consumer.** Today the only provider wraps the active tab, so
  the fallback path (no provider → the active tab) would have sufficed. The provider is kept because
  it is what makes "this subtree belongs to that tab" expressible at all, and because it is the
  thing the isolation tests drive.
