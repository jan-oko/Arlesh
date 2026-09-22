import { useState } from "react";
import Switch from "@/components/Switch/Switch";
import styles from "./PaneMenu.module.css";

/** One switch in a pane's menu. */
export interface PaneOption {
  id: string;
  label: string;
  checked: boolean;
  onToggle: () => void;
}

interface Props {
  /** The menu's accessible name — it says which pane's options these are. */
  label: string;
  options: readonly PaneOption[];
}

const KEBAB = "⋮";

/**
 * The options of **one pane**, on a kebab beside that pane's own heading.
 *
 * They used to be switches in the window's settings popover, gated on the Plan View being the view
 * on screen. Two problems with that, and the second is the one that mattered: a control three rows
 * up from the thing it acts on has to name which half it means, and a settings popover is somewhere
 * you go once, not somewhere you reach for mid-pass. A planning pass changes its mind about how it
 * wants to read a pane while it is reading it.
 */
export default function PaneMenu({ label, options }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className={styles.anchor}>
      <button
        type="button"
        className={styles.button}
        aria-label={label}
        aria-expanded={open}
        title={label}
        onClick={(event) => { event.stopPropagation(); setOpen((wasOpen) => !wasOpen); }}
      >
        {KEBAB}
      </button>
      {open && (
        <>
          <div className={styles.backdrop} onClick={() => setOpen(false)} />
          <div className={styles.menu} role="group" aria-label={label}>
            {options.map((option) => (
              <div key={option.id} className={styles.row} onClick={(event) => event.stopPropagation()}>
                <Switch checked={option.checked} onChange={option.onToggle} label={option.label} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
