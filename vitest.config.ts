import { defineConfig, configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Sibling git worktrees live under .claude/worktrees/ and carry their own full source
    // copy — without this, a run from the repo root also re-runs every test in each of
    // them, doubling load and causing unrelated timeouts.
    exclude: [...configDefaults.exclude, ".claude/worktrees/**"],
  },
});
