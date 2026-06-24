import type en_common from "./locales/en/common.json";
import type en_contextMenu from "./locales/en/contextMenu.json";
import type en_editor from "./locales/en/editor.json";
import type en_nodeKinds from "./locales/en/nodeKinds.json";
import type en_status from "./locales/en/status.json";
import type en_warnings from "./locales/en/warnings.json";
import type en_navigation from "./locales/en/navigation.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: {
      common: typeof en_common;
      contextMenu: typeof en_contextMenu;
      editor: typeof en_editor;
      nodeKinds: typeof en_nodeKinds;
      status: typeof en_status;
      warnings: typeof en_warnings;
      navigation: typeof en_navigation;
    };
  }
}
