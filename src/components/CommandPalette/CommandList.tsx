import type { SurfaceCommand } from "@/stores/use-command-surface-store";
import { formatChord } from "@/utils/hotkeys/chord";
import { useCommandLabel } from "@/hooks/use-command-label";
import styles from "./CommandPalette.module.css";

interface Props {
  commands: readonly SurfaceCommand[];
  /** Runs the chosen command; the caller closes whatever it was listed in first. */
  onRun: (command: SurfaceCommand) => void;
}

/** Commands as tappable rows, each with its action and the key that does the same. */
export default function CommandList({ commands, onRun }: Props) {
  const labelOf = useCommandLabel();
  return (
    <ul className={styles.list}>
      {commands.map((command) => (
        <li key={command.id}>
          <button type="button" className={styles.row} onClick={() => onRun(command)}>
            <span className={styles.label}>{labelOf(command.label)}</span>
            {command.chord !== null && <kbd className={styles.chord}>{formatChord(command.chord)}</kbd>}
          </button>
        </li>
      ))}
    </ul>
  );
}
