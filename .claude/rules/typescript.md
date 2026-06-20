# TypeScript Conventions

### Compiler settings (`tsconfig.json`)
```json
{
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true,
  "noImplicitReturns": true
}
```

### Types
- `interface` for object shapes (extendable, clear intent)
- `type` for unions, intersections, mapped types, and primitive aliases
- `any` is **banned** — use `unknown` and narrow with type guards
- `as` type assertions are **banned** — use type guards or `satisfies`

### Naming and files
- Component files: `PascalCase.tsx` (e.g. `TaskRow.tsx`, `MindmapView.tsx`)
- All other files: `kebab-case.ts` (e.g. `filter-logic.ts`, `use-tasks.ts`)

### Exports
- **Named exports** for everything except React components
- React components use **default export** (`export default function TaskRow`)

### Imports
- Path alias: `@/` maps to `src/`
- No `../../` climbing — always use `@/`
