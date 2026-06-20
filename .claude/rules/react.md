# React Conventions

### State management
- Local/transient UI state: `useState` / `useReducer`
- Cross-component and persistent app state: **Zustand** stores
- One Zustand store per domain (e.g. `useTaskStore`, `useFilterStore`)

### Styling
- **CSS Modules** (`.module.css`) for component-scoped styles
- **CSS custom properties** for design tokens (colors, spacing, typography)
- Tokens defined globally in `src/styles/tokens.css`

### Component structure
- One component per file
- Prop types defined in the same file, immediately above the component
- No barrel `index.ts` re-exports within component folders

### Hooks
- All custom hooks live in `src/hooks/` regardless of usage scope
- Hook files: `kebab-case.ts` (e.g. `use-task-filter.ts`)

### Tauri IPC
Two-layer pattern:
1. **`src/api/`** — typed wrappers around `invoke()`, one file per domain. Return typed results, no loading state.
   ```ts
   // src/api/tasks.ts
   export async function fetchTasks(filter: TaskFilter): Promise<Task[]> {
     return invoke<Task[]>('get_tasks', { filter })
   }
   ```
2. **`src/hooks/`** — hooks compose `src/api/` calls and manage loading/error state for components.
   ```ts
   // src/hooks/use-tasks.ts
   export function useTasks(filter: TaskFilter) {
     const [tasks, setTasks] = useState<Task[]>([])
     // ...
   }
   ```
- Components **never** call `invoke()` directly

### Testing
- **Custom hooks**: `renderHook()` unit tests
- **Pure TS logic** (filters, scope containment, inheritance): unit tests
- **Components**: integration tests via React Testing Library — test behavior, not implementation
- No snapshot tests
