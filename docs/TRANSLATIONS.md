# Translations

Arlesh supports multiple languages via `react-i18next`. Translation files live in `src/i18n/locales/{lang}/{namespace}.json`.

---

## Adding a language

1. Copy `src/i18n/locales/en/` to `src/i18n/locales/{lang}/`.
2. Translate every value in every JSON file. Keys must not change.
3. In `src/i18n/index.ts`, import all namespace files for the new locale and add an entry to the `resources` object.
4. In `src/components/TopBar/TopBar.tsx`, add a branch to `toggleLanguage()` and update the button label.

---

## Namespaces

| Namespace      | Content                                      |
|----------------|----------------------------------------------|
| `common`       | Save, Cancel, Loading, Error                 |
| `contextMenu`  | Context menu item labels                     |
| `editor`       | Modal headings, field labels, placeholders   |
| `nodeKinds`    | Entity display names                         |
| `status`       | Status pill labels (task / goal / project)   |
| `warnings`     | Warning modal copy and toast messages        |
| `navigation`   | Subtree navigation pill label                |

---

## Domain terminology

| English           | Hebrew        | Notes                                              |
|-------------------|---------------|----------------------------------------------------|
| Aspect            | היבט          | Six fixed life-area containers (Red, Purple…)      |
| Project           | פרויקט        | Large domain under an Aspect                       |
| Domain            | גזרה          | General organizational container                  |
| Tag (sing.)       | תג            | Flat leaf marker node                              |
| Tags (pl.)        | תגיות         |                                                    |
| Goal              | מטרה          | Desired state entity                               |
| Task              | משימה         | Action item                                        |
| Blocker           | חסם           | Condition preventing task progress                 |
| Dependency        | תלות          | Prerequisite relationship                          |
| Dependencies      | תלויות        |                                                    |
| Knowledge Base    | בסיס ידע      | External Obsidian vault                            |
| Scope             | מסגרת         | Time-range entity                                  |
| Season            | עונה          | 3-month period                                     |
| Month             | חודש          |                                                    |
| Week              | שבוע          |                                                    |
| Day               | יום           |                                                    |
| Person            | אדם / אנשים   | KB person entity                                   |
| Event             | אירוע         | KB event entity                                    |
| Thread            | שרשור         | KB train-of-thought entity                         |

---

## Status values

### Task

| Key          | English     | Hebrew    |
|--------------|-------------|-----------|
| `todo`       | To Do       | פתוח      |
| `in_progress`| In Progress | בתהליך    |
| `done`       | Done        | בוצע      |

### Goal

| Key        | English  | Hebrew   |
|------------|----------|----------|
| `active`   | Active   | פעיל     |
| `achieved` | Achieved | הושלם    |
| `frozen`   | Frozen   | מוקפא    |
| `archived` | Archived | בוידעם   |

### Project

| Key         | English   | Hebrew   |
|-------------|-----------|----------|
| `active`    | Active    | פעיל     |
| `paused`    | Paused    | מושהה    |
| `completed` | Completed | הושלם    |
| `archived`  | Archived  | בוידעם   |
