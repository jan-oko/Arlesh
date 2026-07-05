import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import en_common from "./locales/en/common.json";
import en_contextMenu from "./locales/en/contextMenu.json";
import en_editor from "./locales/en/editor.json";
import en_nodeKinds from "./locales/en/nodeKinds.json";
import en_status from "./locales/en/status.json";
import en_warnings from "./locales/en/warnings.json";
import en_navigation from "./locales/en/navigation.json";
import en_scopes from "./locales/en/scopes.json";
import en_filter from "./locales/en/filter.json";
import en_statusIcons from "./locales/en/statusIcons.json";
import en_listView from "./locales/en/listView.json";

import he_common from "./locales/he/common.json";
import he_contextMenu from "./locales/he/contextMenu.json";
import he_editor from "./locales/he/editor.json";
import he_nodeKinds from "./locales/he/nodeKinds.json";
import he_status from "./locales/he/status.json";
import he_warnings from "./locales/he/warnings.json";
import he_navigation from "./locales/he/navigation.json";
import he_scopes from "./locales/he/scopes.json";
import he_filter from "./locales/he/filter.json";
import he_statusIcons from "./locales/he/statusIcons.json";
import he_listView from "./locales/he/listView.json";

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        common: en_common,
        contextMenu: en_contextMenu,
        editor: en_editor,
        nodeKinds: en_nodeKinds,
        status: en_status,
        warnings: en_warnings,
        navigation: en_navigation,
        scopes: en_scopes,
        filter: en_filter,
        statusIcons: en_statusIcons,
        listView: en_listView,
      },
      he: {
        common: he_common,
        contextMenu: he_contextMenu,
        editor: he_editor,
        nodeKinds: he_nodeKinds,
        status: he_status,
        warnings: he_warnings,
        navigation: he_navigation,
        scopes: he_scopes,
        filter: he_filter,
        statusIcons: he_statusIcons,
        listView: he_listView,
      },
    },
    fallbackLng: "en",
    detection: {
      order: ["localStorage"],
      lookupLocalStorage: "arlesh-language",
      caches: ["localStorage"],
    },
    interpolation: {
      escapeValue: false,
    },
  });

export default i18n;
