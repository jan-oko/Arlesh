import { useTranslation } from "react-i18next";
import { useDisplayStore } from "@/stores/use-display-store";
import Switch from "@/components/Switch/Switch";
import styles from "./SettingsModal.module.css";

/** How the List View orders its rows, where Commitments and Expectations sit, and whether an Overdue
 * row is drawn with its amber border. App-wide. */
export default function ListPage() {
  const { t } = useTranslation("common");
  const asynchronousFirst = useDisplayStore((s) => s.asynchronousFirst);
  const toggleAsynchronousFirst = useDisplayStore((s) => s.toggleAsynchronousFirst);
  const overdueFirst = useDisplayStore((s) => s.overdueFirst);
  const toggleOverdueFirst = useDisplayStore((s) => s.toggleOverdueFirst);
  const showOverdueBorder = useDisplayStore((s) => s.listShowOverdueBorder);
  const toggleShowOverdueBorder = useDisplayStore((s) => s.toggleListShowOverdueBorder);
  const listBands = useDisplayStore((s) => s.listBands);
  const toggleListBands = useDisplayStore((s) => s.toggleListBands);

  return (
    <div className={styles.page}>
      <Switch checked={overdueFirst} onChange={toggleOverdueFirst} label={t("overdueFirst")} />
      <Switch checked={asynchronousFirst} onChange={toggleAsynchronousFirst} label={t("asynchronousFirst")} />
      <Switch checked={listBands} onChange={toggleListBands} label={t("listBands")} />
      <Switch checked={showOverdueBorder} onChange={toggleShowOverdueBorder} label={t("listShowOverdueBorder")} />
    </div>
  );
}
