- **A gesture on the Mindmap that cannot act now says so, instead of doing nothing.** Several keys
  used to fail in silence, which is indistinguishable from a broken keyboard. `Delete` on an Aspect
  did nothing at all, and an Aspect in a multi-selection was quietly dropped from the delete set
  while everything else went; `Shift+Enter` and `Ctrl+Shift+Enter` on one were equally inert. All
  three now name the reason — the Aspects are fixed, they can't be deleted, they have no new one
  alongside them and nothing above them — and a selection holding an Aspect refuses the whole
  delete rather than taking the rest, exactly as a Habit repetition already did. `Tab` on a Tag or
  on a folded run of Habit history says why nothing hangs there.

  **And every refusal the backend raises now reaches you.** A paste it rejected — a cycle, a
  constraint, a stale row — used to leave a board that had silently not changed, and a refused
  rename left the old title in place with nothing said. Paste, rename, both status controls,
  `Tab`, `Shift+Enter` and `Ctrl+Shift+Enter` all now show what failed together with the reason
  given. When a paste both skipped something and was then refused, the two are shown in one
  message rather than the second quietly replacing the first.

  **`Shift+F` on a Habit occurrence is fixed** — it opened the Flow editor on a repetition that has
  no row behind it, and saving could only fail. It is refused up front now, as `Shift+C` already
  was. The rule behind all of these is asked about the node rather than about its kind, so a folded
  run of Habit history no longer accepts dropped or pasted nodes, a drag no longer offers a target
  it cannot write to, and creating a Task under a Habit occurrence works in the List View as it
  already did on the Mindmap.
