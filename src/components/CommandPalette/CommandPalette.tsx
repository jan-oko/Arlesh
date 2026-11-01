import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import BottomSheet from "@/components/BottomSheet/BottomSheet";
import { allSurfaceCommands, useCommandSurfaceStore } from "@/stores/use-command-surface-store";
import type { SurfaceCommand } from "@/stores/use-command-surface-store";
import { usePaletteStore } from "@/stores/use-palette-store";
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
  const labelOf = useCommandLabel();
  const [query, setQuery] = useState("");

  const entries = useMemo(
    () => paletteEntries(allSurfaceCommands(tables), { showTabs }),
    // `revision` is what says a guard may now read differently.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tables, revision, showTabs],
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
      {shown.length === 0
        ? <p className={styles.empty}>{t("paletteEmpty")}</p>
        : <CommandList commands={shown} onRun={run} />}
    </BottomSheet>
  );
}
