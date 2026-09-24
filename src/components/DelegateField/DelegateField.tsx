import { useTranslation } from "react-i18next";
import type { Delegate } from "@/api/tasks";
import type { Person } from "@/api/people";
import styles from "@/components/EditorModal/EditorModal.module.css";

interface Props {
  value: Delegate | null;
  people: readonly Person[];
  onChange: (delegate: Delegate | null) => void;
}

const NOBODY = "nobody";
const AGENT = "agent";

/** A delegate's option value: `nobody`, `agent`, or `person:<id>`. */
function optionOf(delegate: Delegate | null): string {
  if (delegate === null) return NOBODY;
  return delegate.kind === "agent" ? AGENT : `person:${delegate.id}`;
}

/** The delegate an option value names; an unknown value reads as nobody. */
function delegateOf(option: string): Delegate | null {
  if (option === AGENT) return { kind: "agent" };
  const match = /^person:(\d+)$/.exec(option);
  return match?.[1] === undefined ? null : { kind: "person", id: Number(match[1]) };
}

/**
 * Picks who holds a Task (the #75 Delegate model): nobody, the Agent, or a Person from the
 * knowledge base. A Person no longer in the list stays selectable under their id, so opening an
 * editor never silently drops a delegate.
 */
export default function DelegateField({ value, people, onChange }: Props) {
  const { t } = useTranslation("editor");
  const current = optionOf(value);
  const missing = value?.kind === "person" && !people.some((person) => person.id === value.id);
  return (
    <label className={styles.label}>
      {t("fieldDelegate")}
      <select
        className={styles.input}
        value={current}
        onChange={(event) => onChange(delegateOf(event.target.value))}
      >
        <option value={NOBODY}>{t("delegateNobody")}</option>
        <option value={AGENT}>{t("delegateAgent")}</option>
        {people.map((person) => (
          <option key={person.id} value={`person:${person.id}`}>{person.name}</option>
        ))}
        {missing && <option value={current}>{t("delegateUnknownPerson")}</option>}
      </select>
    </label>
  );
}
