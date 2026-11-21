import { useTranslation } from "react-i18next";
import type { Account } from "@/api/agents";
import Switch from "@/components/Switch/Switch";
import { limitsText } from "@/utils/agents";
import own from "./AgentsSection.module.css";

const KNOWN_KINDS = ["five_hour", "seven_day"] as const;

function isKnownKind(kind: string): kind is (typeof KNOWN_KINDS)[number] {
  return KNOWN_KINDS.some((known) => known === kind);
}

interface Props {
  account: Account;
  onLock: (locked: boolean) => void;
  /** Whether other accounts are in use too, so the switch must say which account it locks. */
  named: boolean;
}

/** An account's lock switch and its limits line ("Five Hours: 8% (4h left) · Week: 20% (2d left)"). */
export default function AccountControls({ account, onLock, named }: Props) {
  const { t } = useTranslation("settings");
  const kinds = {
    five_hour: t("mcp.agents.windowName.five_hour"),
    seven_day: t("mcp.agents.windowName.seven_day"),
  };
  const limits = limitsText(account.windows, new Date(), {
    name: (kind) => (isKnownKind(kind) ? kinds[kind] : kind),
    limit: (window, percent, left) => t("mcp.agents.limit", { window, percent, left }),
    separator: t("mcp.agents.separator"),
  });

  return (
    <>
      <Switch
        checked={account.locked}
        onChange={onLock}
        label={named ? t("mcp.agents.accountLock", { label: account.label }) : t("mcp.agents.accountLockSingle")}
      />
      <span className={own.limits}>{limits === "" ? t("mcp.agents.noUsage") : limits}</span>
    </>
  );
}
