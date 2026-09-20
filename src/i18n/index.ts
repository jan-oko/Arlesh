import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en_common from "./locales/en/common.json";
import en_contextMenu from "./locales/en/contextMenu.json";
import en_editor from "./locales/en/editor.json";
import en_nodeKinds from "./locales/en/nodeKinds.json";
import en_status from "./locales/en/status.json";
import en_warnings from "./locales/en/warnings.json";
import en_scopes from "./locales/en/scopes.json";
import en_filter from "./locales/en/filter.json";
import en_statusIcons from "./locales/en/statusIcons.json";
import en_listView from "./locales/en/listView.json";
import en_hotkeys from "./locales/en/hotkeys.json";

// English is the only locale. i18next stays in place so every user-facing string keeps a key
// (see docs/TRANSLATIONS.md) and a second locale can be added without touching components.
void i18n.use(initReactI18next).init({
  resources: {
    en: {
      common: en_common,
      contextMenu: en_contextMenu,
      editor: en_editor,
      nodeKinds: en_nodeKinds,
      status: en_status,
      warnings: en_warnings,
      scopes: en_scopes,
      filter: en_filter,
      statusIcons: en_statusIcons,
      listView: en_listView,
      hotkeys: en_hotkeys,
    },
  },
  lng: "en",
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
