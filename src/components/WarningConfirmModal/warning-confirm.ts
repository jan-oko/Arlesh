export const WARNING_VARIANT = {
  PRIMARY: "primary",
  DANGER: "danger",
} as const;

export interface WarningAction {
  label: string;
  variant: "primary" | "danger";
  onClick: () => void;
}
