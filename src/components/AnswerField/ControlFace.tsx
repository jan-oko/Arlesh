import type { ReactNode } from "react";

interface Props {
  /** Whether the touch layout shows icons rather than words. */
  touch: boolean;
  /** The control's translated name: the text on a desktop, the accessible name on touch. */
  label: string;
  /** The icon drawn on touch. */
  icon: ReactNode;
}

/** The face of an answer control: its label on a desktop, its icon on the phone. */
export default function ControlFace({ touch, label, icon }: Props) {
  return touch ? icon : label;
}
