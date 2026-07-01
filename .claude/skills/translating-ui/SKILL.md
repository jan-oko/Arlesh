---
name: translating-ui
description: Use when adding or changing any user-facing string in the React frontend — JSX text, button/label/field text, placeholders, titles, or user-visible aria labels; anytime the i18next/no-literal-string ESLint rule fires, or a new UI term needs a translation.
---

# Translating UI

## Overview

Every user-facing string in the frontend goes through **i18next**. A string ships only when it clears **three gates**: two automated (ESLint, tsc) and one human (Hebrew). `docs/TRANSLATIONS.md` is the source of truth for namespaces, the domain glossary, and status values — consult it, don't duplicate it here.

**Never ship a literal user-facing string, and never silence the linter with a `t()` key that has no real entry.** Deferring i18n ("English placeholder for now") does not work — the stop hook's ESLint gate blocks the commit.

## The three gates

1. **ESLint — `i18next/no-literal-string`**: no literal user-facing text in JSX. It flags direct children/attributes; strings hidden in expressions or ternaries (`{open ? "close" : "edit"}`) may slip past it — i18n those too. Wrapping in `t()` is the fix, **not** `// eslint-disable`.
2. **tsc — keys are typed from the English JSON** (`src/i18n/types.d.ts` augments i18next `resources` from `en/*.json`). `t("unknownKey")` is a **compile error**. So adding `t("newKey")` without adding `newKey` to `en/<ns>.json` fails tsc — you cannot appease ESLint by inventing a key. Add the English entry first, then reference it. Never cast the key to dodge this.
3. **Hebrew — human only**: tsc checks **English only**; a key missing from `he/<ns>.json` is **not** caught and falls back to English silently (looks fine in English, broken in Hebrew). Keeping Hebrew complete is your responsibility. **When a term is a domain term with no established Hebrew, you cannot invent it — use AskUserQuestion to get it from the user.** Check `docs/TRANSLATIONS.md`'s domain glossary first; many terms are already fixed there.

## Mechanism

- Files: `src/i18n/locales/{en,he}/{namespace}.json`; registered in `src/i18n/index.ts`; typed in `src/i18n/types.d.ts`.
- Use: `const { t } = useTranslation("<ns>")` then `t("key")`; interpolation `t("key", { name })` with `"{{name}}"` in the value.
- Fallback: `fallbackLng: "en"`, so missing Hebrew renders English (the silent trap above).

## Workflow

1. **Run `/domain-modeling`** to confirm the term is canonical (align with `CONTEXT.md` and the `TRANSLATIONS.md` glossary) before naming a key.
2. **Pick the namespace** from the `TRANSLATIONS.md` table. A *new* namespace must also be registered in `src/i18n/index.ts` **and** `src/i18n/types.d.ts` (and added to every locale).
3. Add the key + English value to `en/<ns>.json`.
4. Add the Hebrew value to `he/<ns>.json`. Domain term with no established Hebrew → **AskUserQuestion**; never invent Hebrew.
5. Reference it with `useTranslation("<ns>")` + `t("key")`.
6. Verify: `npx eslint src` (no literal-string errors) and `npx tsc --noEmit` (keys resolve).

## Red flags — stop

- Wrapping a literal in `t("madeUpKey")` without adding a real entry.
- `// eslint-disable-next-line i18next/no-literal-string`, or casting the `t()` key.
- Inventing a Hebrew translation for a domain term instead of asking.
- Leaving `he/<ns>.json` missing the key (falls back silently).
- "I'll translate later" / English-only placeholder.
