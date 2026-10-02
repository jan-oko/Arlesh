import { useTranslation } from "react-i18next";
import type { AsyncTemplate } from "@/api/tasks";
import type { Domain } from "@/api/domains";
import Switch from "@/components/Switch/Switch";
import AsyncTemplateFields from "@/components/AsyncTemplateEditor/AsyncTemplateFields";
import styles from "@/components/EditorModal/EditorModal.module.css";

interface Props {
  asynchronous: boolean;
  onAsynchronousChange: (asynchronous: boolean) => void;
  compound: boolean;
  onCompoundChange: (compound: boolean) => void;
  asyncTemplate: AsyncTemplate;
  onAsyncTemplateChange: (template: AsyncTemplate) => void;
  /** What the wait's title defaults to when left blank. */
  titlePlaceholder: string;
  allTags: Domain[];
  domainNames: Map<number, string>;
}

/**
 * A Task template's **Asynchronous** switch with, directly under it, the wait every instance's
 * completion spawns — the Task editor's fields — and then its **Compound** switch. Shared by the editors of a flow
 * Task item and of a task-instance Flow's root, the two templates that carry them.
 */
export default function TaskTemplateFlags({
  asynchronous, onAsynchronousChange, compound, onCompoundChange, asyncTemplate, onAsyncTemplateChange,
  titlePlaceholder, allTags, domainNames,
}: Props) {
  const { t } = useTranslation(["editor", "expectation"]);
  return (
    <>
      <div className={styles.label}>
        {t("fieldAsynchronous")}
        <Switch
          checked={asynchronous}
          onChange={onAsynchronousChange}
          label={asynchronous ? t("asynchronousOn") : t("asynchronousOff")}
        />
      </div>
      {asynchronous && (
        <div role="group" aria-label={t("expectation:templateSection")}>
          <span className={styles.label}>{t("expectation:templateSection")}</span>
          <AsyncTemplateFields
            value={asyncTemplate}
            onChange={onAsyncTemplateChange}
            titlePlaceholder={titlePlaceholder}
            allTags={allTags}
            domainNames={domainNames}
          />
        </div>
      )}
      {/* Compound, after Asynchronous and its wait: every instance's status follows its
          sub-items. */}
      <div className={styles.label}>
        {t("fieldCompound")}
        <Switch
          checked={compound}
          onChange={onCompoundChange}
          label={compound ? t("compoundOn") : t("compoundOff")}
        />
      </div>
    </>
  );
}
