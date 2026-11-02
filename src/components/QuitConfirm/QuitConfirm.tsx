import { useTranslation } from "react-i18next";
import WarningConfirmModal from "@/components/WarningConfirmModal/WarningConfirmModal";
import { WARNING_VARIANT } from "@/components/WarningConfirmModal/warning-confirm";
import { useQuit } from "@/hooks/use-close-to-tray";
import { useQuitConfirmStore } from "@/stores/use-quit-confirm-store";

/** "Quit Arlesh?": what Android's back asks at the board's root. Back again, or Cancel, stays. */
export default function QuitConfirm() {
  const { t } = useTranslation("common");
  const isOpen = useQuitConfirmStore((s) => s.isOpen);
  const hide = useQuitConfirmStore((s) => s.hide);
  const quit = useQuit();
  if (!isOpen) return null;
  return (
    <WarningConfirmModal
      heading={t("quitHeading")}
      consequences={[]}
      actions={[{ label: t("quit"), variant: WARNING_VARIANT.DANGER, onClick: () => { hide(); quit(); } }]}
      onCancel={hide}
    />
  );
}
