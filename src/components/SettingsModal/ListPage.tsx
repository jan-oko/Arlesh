import { useTranslation } from "react-i18next";
import { useDisplayStore } from "@/stores/use-display-store";
import Switch from "@/components/Switch/Switch";
import styles from "./SettingsModal.module.css";

/** How the List View orders its rows and where Commitments and Expectations sit. App-wide. */
export default function ListPage() {
  const { t } = useTranslation("common");
  const asynchronousFirst = useDisplayStore((s) => s.asynchronousFirst);
  const toggleAsynchronousFirst = useDisplayStore((s) => s.toggleAsynchronousFirst);
  const listBands = useDisplayStore((s) => s.listBands);
  const toggleListBands = useDisplayStore((s) => s.toggleListBands);

  return (
    <div className={styles.page}>
      <Switch checked={asynchronousFirst} onChange={toggleAsynchronousFirst} label={t("asynchronousFirst")} />
      <Switch checked={listBands} onChange={toggleListBands} label={t("listBands")} />
    </div>
  );
}
