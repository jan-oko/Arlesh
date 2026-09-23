import type en_common from "./locales/en/common.json";
import type en_contextMenu from "./locales/en/contextMenu.json";
import type en_editor from "./locales/en/editor.json";
import type en_nodeKinds from "./locales/en/nodeKinds.json";
import type en_status from "./locales/en/status.json";
import type en_warnings from "./locales/en/warnings.json";
import type en_scopes from "./locales/en/scopes.json";
import type en_filter from "./locales/en/filter.json";
import type en_statusIcons from "./locales/en/statusIcons.json";
import type en_listView from "./locales/en/listView.json";
import type en_hotkeys from "./locales/en/hotkeys.json";
import type en_undo from "./locales/en/undo.json";
import type en_habits from "./locales/en/habits.json";
import type en_planView from "./locales/en/planView.json";
import type en_expectation from "./locales/en/expectation.json";

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
      scopes: typeof en_scopes;
      filter: typeof en_filter;
      statusIcons: typeof en_statusIcons;
      listView: typeof en_listView;
      hotkeys: typeof en_hotkeys;
      undo: typeof en_undo;
      habits: typeof en_habits;
      planView: typeof en_planView;
      expectation: typeof en_expectation;
    };
  }
}
