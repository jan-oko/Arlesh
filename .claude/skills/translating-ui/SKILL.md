---
name: translating-ui
description: Use when adding or changing any user-facing string in the React frontend — JSX text, button/label/field text, placeholders, titles, or user-visible aria labels; anytime the i18next/no-literal-string ESLint rule fires, or a new UI term needs a key.
---

# Translating UI

## Overview

Every user-facing string in the frontend goes through **i18next** — English is the only locale,
but strings still live in JSON under a key rather than as literals in JSX. A string ships only
when it clears **two automated gates**: ESLint and tsc. `docs/TRANSLATIONS.md` is the source of
truth for namespaces — consult it, don't duplicate it here.

**Never ship a literal user-facing string, and never silence the linter with a `t()` key that has no real entry.** Deferring i18n ("literal for now") does not work — the stop hook's ESLint gate blocks the commit.

## The two gates

1. **ESLint — `i18next/no-literal-string`**: no literal user-facing text in JSX. It flags direct children/attributes; strings hidden in expressions or ternaries (`{open ? "close" : "edit"}`) may slip past it — key those too. Wrapping in `t()` is the fix, **not** `// eslint-disable`.
2. **tsc — keys are typed from the English JSON** (`src/i18n/types.d.ts` augments i18next `resources` from `en/*.json`). `t("unknownKey")` is a **compile error**. So adding `t("newKey")` without adding `newKey` to `en/<ns>.json` fails tsc — you cannot appease ESLint by inventing a key. Add the English entry first, then reference it. Never cast the key to dodge this.

## Mechanism

- Files: `src/i18n/locales/en/{namespace}.json`; registered in `src/i18n/index.ts`; typed in `src/i18n/types.d.ts`.
- Use: `const { t } = useTranslation("<ns>")` then `t("key")`; interpolation `t("key", { name })` with `"{{name}}"` in the value.

## Workflow

1. **Run `/domain-modeling`** to confirm the term is canonical (align with `CONTEXT.md`) before naming a key.
2. **Pick the namespace** from the `TRANSLATIONS.md` table. A *new* namespace must also be registered in `src/i18n/index.ts` **and** `src/i18n/types.d.ts`.
3. Add the key + English value to `en/<ns>.json`.
4. Reference it with `useTranslation("<ns>")` + `t("key")`.
5. Verify: `npx eslint src` (no literal-string errors) and `npx tsc --noEmit` (keys resolve).

## Red flags — stop

- Wrapping a literal in `t("madeUpKey")` without adding a real entry.
- `// eslint-disable-next-line i18next/no-literal-string`, or casting the `t()` key.
- "I'll key it later" / literal placeholder.
