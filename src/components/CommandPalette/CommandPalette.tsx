import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import { useBoardReadOnly } from "@/hooks/use-board-read-only";
import { gateWrites } from "@/utils/touch/writes";
import { allSurfaceCommands, useCommandSurfaceStore } from "@/stores/use-command-surface-store";
import type { SurfaceCommand } from "@/stores/use-command-surface-store";
import { usePaletteStore } from "@/stores/use-palette-store";
import { useSelectModeStore } from "@/stores/use-select-mode-store";
import { useSelectionSurfaceStore } from "@/stores/use-selection-surface-store";
import { useCommandLabel } from "@/hooks/use-command-label";
import { paletteEntries } from "@/utils/touch/palette";
import { formatChord } from "@/utils/hotkeys/chord";
import CommandList from "./CommandList";
import styles from "./CommandPalette.module.css";

interface Props {
  /** Whether the tab strip is drawn: the tab chords are listed only where tabs can be seen. */
  showTabs: boolean;
}

/**
 * The command palette (`docs/spec/touch.md`): every binding of the hotkey registry that can act
 * right now, generated from the tables the mounted views publish, each with its key. Choosing a
 * row closes the sheet and runs the binding exactly as its key would.
 */
export default function CommandPalette({ showTabs }: Props) {
  const { t } = useTranslation("touch");
  const close = usePaletteStore((s) => s.close);
  const tables = useCommandSurfaceStore((s) => s.tables);
  const revision = useCommandSurfaceStore((s) => s.revision);
  const readOnly = useBoardReadOnly() !== null;
  const labelOf = useCommandLabel();
  const [query, setQuery] = useState("");
  // The Select toggle, where the view can hold several: taps then build the selection.
  const multiSelect = useSelectionSurfaceStore((s) => s.multiSelect);
  const selecting = useSelectModeStore((s) => s.active);
  const toggleSelecting = useSelectModeStore((s) => s.toggle);

  const entries = useMemo(
    () => paletteEntries(gateWrites(allSurfaceCommands(tables), readOnly), { showTabs }),
    // `revision` is what says a guard may now read differently.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tables, revision, showTabs, readOnly],
  );
  const needle = query.trim().toLowerCase();
  const shown = needle === "" ? entries : entries.filter((command) =>
    [labelOf(command.label), command.chord === null ? "" : formatChord(command.chord)]
      .some((text) => text.toLowerCase().includes(needle)));

  function run(command: SurfaceCommand) {
    close();
    command.run();
  }

  return (
    <BottomSheet title={t("paletteTitle")} onClose={close}>
      <input
        className={styles.search}
        type="search"
        value={query}
        placeholder={t("paletteSearch")}
        aria-label={t("paletteSearch")}
        onChange={(event) => setQuery(event.target.value)}
      />
      {multiSelect && (
        <button
          type="button"
          className={styles.toggle}
          aria-pressed={selecting}
          title={t("paletteSelectHint")}
          onClick={() => { toggleSelecting(); close(); }}
        >
          <span>{t("paletteSelect")}</span>
          <span className={styles.toggleHint}>{t("paletteSelectHint")}</span>
        </button>
      )}
      {shown.length === 0
        ? <p className={styles.empty}>{t("paletteEmpty")}</p>
        : <CommandList commands={shown} onRun={run} />}
    </BottomSheet>
  );
}
