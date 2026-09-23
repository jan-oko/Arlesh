- **Apply no longer throws away the scope you already had.** Opening the Scope Picker on a task
  that was already scoped and pressing Apply without clicking a cell cleared the scope: nothing had
  been chosen, so the picker reported "no scope" rather than "no change". The picker now opens with
  that scope selected — the period it shows is the period Apply commits — so applying an untouched
  picker re-applies what was there, and a range round-trips with both its endpoints. Applying with
  nothing selected now changes nothing at all. Clearing is Clear's job, and Clear's alone. The Plan
  picker behaves the same way.
