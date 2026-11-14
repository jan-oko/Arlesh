import type { TFunction } from "i18next";
import type { GraphNodeKind } from "@/data/derivation-graph";

/** The words for a box's kind: the chrome's, in the app's language. */
export function kindLabel(t: TFunction<"help">, kind: GraphNodeKind): string {
  switch (kind) {
    case "in": return t("kindStored");
    case "dv": return t("kindDerived");
    case "rd": return t("kindPreset");
  }
}
