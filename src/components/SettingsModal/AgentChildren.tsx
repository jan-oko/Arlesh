import { useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import own from "./AgentsSection.module.css";

interface Props {
  /** The parent's name, for the list's label. */
  parent: string;
  /** How many child agents there are. */
  count: number;
  /** The child rows. */
  children: ReactNode;
}

const OPEN_GLYPH = "▾";
const CLOSED_GLYPH = "▸";

/**
 * An agent's subagents, folded away until the user opens them. Closed by default, and not
 * remembered: it is a glance at who is working under an agent, not a setting.
 */
export default function AgentChildren({ parent, count, children }: Props) {
  const { t } = useTranslation("settings");
  const [open, setOpen] = useState(false);
  const listId = useId();
  return (
    <>
      <button
        className={own.disclosure}
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((was) => !was)}
      >
        <span aria-hidden="true">{open ? OPEN_GLYPH : CLOSED_GLYPH}</span>
        <span>{t("mcp.agents.subagentsToggle", { count })}</span>
      </button>
      {open && (
        <ul id={listId} className={own.children} aria-label={t("mcp.agents.subagents", { name: parent })}>
          {children}
        </ul>
      )}
    </>
  );
}
