# Translations

Every user-facing string in the frontend goes through `react-i18next` rather than sitting as a
literal in JSX. Translation files live in `src/i18n/locales/{lang}/{namespace}.json`.

**English is currently the only locale.** i18next stays in place because it keeps every string
addressable by key — which makes wording changes a one-file edit and leaves the door open to a
second locale — not because a translation is pending.

---

## Namespaces

| Namespace      | Content                                        |
|----------------|------------------------------------------------|
| `common`       | Save, Cancel, Loading, Error                   |
| `contextMenu`  | Context menu item labels                       |
| `editor`       | Modal headings, field labels, placeholders     |
| `nodeKinds`    | Entity display names                           |
| `status`       | Status pill labels (task / goal / project)     |
| `warnings`     | Warning modal copy and toast messages          |
| `scopes`       | Time-scope and plan window labels              |
| `filter`       | Filter popover and chip labels                 |
| `statusIcons`  | Status-badge tooltips                          |
| `listView`     | List View presets, columns, empty states       |
| `hotkeys`      | Keyboard cheat-sheet action labels             |

---

## Adding a string

1. Add the key and its English value to `src/i18n/locales/en/<namespace>.json`.
2. Reference it with `const { t } = useTranslation("<namespace>")` then `t("key")`.
   Interpolation: `t("key", { name })` against a `"{{name}}"` placeholder in the value.

Keys are typed from the English JSON (`src/i18n/types.d.ts`), so `t("unknownKey")` is a compile
error — add the entry before referencing it.

A *new* namespace must be registered in both `src/i18n/index.ts` and `src/i18n/types.d.ts`.

---

## Adding a language

1. Copy `src/i18n/locales/en/` to `src/i18n/locales/{lang}/` and translate every value.
   Keys must not change.
2. In `src/i18n/index.ts`, import the new locale's namespace files, add them to `resources`,
   and drop the hardcoded `lng: "en"` in favour of a language detector or an explicit setting.
3. Add a way to switch languages (the settings popover in `TopBar.tsx` is the natural home).
4. If the language is right-to-left, set `dir` on the app shell in `App.tsx` from
   `i18n.dir()`, and re-check any layout that assumes a left leading edge —
   `StatusIconRow` in particular.

Note that `src/utils/text-direction.ts` handles the direction of **user-entered content**
(node titles) and is independent of the UI language — it stays correct either way.
