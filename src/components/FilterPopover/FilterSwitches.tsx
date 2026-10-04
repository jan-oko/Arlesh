import { useTranslation } from "react-i18next";
import { useFilterStore } from "@/stores/use-filter-store";
import { useSetPrivateMode } from "@/hooks/use-private-mode";
import type { View } from "@/stores/use-view-store";
import { filterSwitchesFor, offersOnAgent, rowKindsFor } from "@/utils/filter-layout";
import { delegatedModeOf } from "@/utils/filter-tree";
import type { StatusMode } from "@/utils/filter-tree";
import Switch from "@/components/Switch/Switch";
import OverridePill from "./OverridePill";
import RowKindSelector from "./RowKindSelector";
import styles from "./FilterPopover.module.css";

interface Props {
  view: View;
  /** The preset the view reads under — the Plan View always reads under Plan. */
  statusMode: StatusMode;
}

/**
 * The switch block at the top of the Filter menu. The List View's row kinds (the Zen View's strips)
 * or the Mindmap's
 * Info / Flow pills (with **Include flows** while the preset is Plan or Start), then, in every view,
 * the Private switch and the Archived, Backlog and Delegated tri-state pills (Delegated on key `g`), and — wherever Start or Do can be
 * read — the **On Agent** pill, which shows the Agentic Tasks an agent holds.
 */
export default function FilterSwitches({ view, statusMode }: Props) {
  const { t } = useTranslation(["filter", "nodeKinds"]);
  const filter = useFilterStore((s) => s.filter);
  const toggleShowInfo = useFilterStore((s) => s.toggleShowInfo);
  const toggleShowFlow = useFilterStore((s) => s.toggleShowFlow);
  const toggleModeFlows = useFilterStore((s) => s.toggleModeFlows);
  const setPrivateMode = useSetPrivateMode();
  const cycleArchivedMode = useFilterStore((s) => s.cycleArchivedMode);
  const cycleBacklogMode = useFilterStore((s) => s.cycleBacklogMode);
  const cycleDelegatedMode = useFilterStore((s) => s.cycleDelegatedMode);
  const delegatedMode = delegatedModeOf(filter);
  const toggleShowOnAgent = useFilterStore((s) => s.toggleShowOnAgent);
  const showOnAgent = filter.showOnAgent === true;
  const switches = filterSwitchesFor(view);
  const showFlowsSub = statusMode === "plan" || statusMode === "start";

  return (
    <div className={styles.switches}>
      {rowKindsFor(view).length > 0 && <RowKindSelector />}
      {view === "mindmap" && (
        <div className={styles.pills} role="group" aria-label={t("nodeTypesLabel")}>
          <button type="button" aria-pressed={filter.showInfo} className={`${styles.typePill}${filter.showInfo ? ` ${styles.typePillActive}` : ""}`} onClick={toggleShowInfo}>
            {t("nodeKinds:info")}
          </button>
          <button type="button" aria-pressed={filter.showFlow} className={`${styles.typePill}${filter.showFlow ? ` ${styles.typePillActive}` : ""}`} onClick={toggleShowFlow}>
            {t("nodeKinds:flow")}
          </button>
          {showFlowsSub && (
            <span className={styles.smallSwitch}>
              <Switch checked={filter.modeIncludeFlows} onChange={toggleModeFlows} label={t("includeFlows")} />
            </span>
          )}
        </div>
      )}
      <div className={styles.pills} role="group" aria-label={t("switchesLabel")}>
        <Switch checked={filter.privateMode} onChange={setPrivateMode} label={t("privateMode")} />
        <span className={styles.switchGap} aria-hidden="true" />
        {switches.includes("archived") && (
          <OverridePill
            label={t("archivedPill")}
            mode={filter.archivedMode}
            title={t(`archivedTooltip.${filter.archivedMode}`)}
            onCycle={cycleArchivedMode}
          />
        )}
        {switches.includes("backlog") && (
          <OverridePill
            label={t("backlogPill")}
            mode={filter.backlogMode}
            title={t(`backlogTooltip.${filter.backlogMode}`)}
            onCycle={cycleBacklogMode}
          />
        )}
        {switches.includes("delegated") && (
          <OverridePill
            label={t("delegatedPill")}
            mode={delegatedMode}
            title={t(`delegatedTooltip.${delegatedMode}`)}
            onCycle={cycleDelegatedMode}
          />
        )}
        {offersOnAgent(view) && (
          <button
            type="button"
            aria-pressed={showOnAgent}
            className={`${styles.typePill}${showOnAgent ? ` ${styles.typePillActive}` : ""}`}
            title={t(showOnAgent ? "onAgentTooltip.on" : "onAgentTooltip.off")}
            onClick={toggleShowOnAgent}
          >
            {t("onAgentPill")}
          </button>
        )}
      </div>
    </div>
  );
}
