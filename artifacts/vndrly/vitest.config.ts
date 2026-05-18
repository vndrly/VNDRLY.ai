import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    testTimeout: 30000,
    // jsdom is required for component tests under src/pages and src/components.
    // Pure-logic .test.ts files (csv, form1099, ...) work fine in jsdom too,
    // so a single environment keeps the config simple.
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      // Regression catalogs (e.g. tests/assistant.spec.ts) live
      // outside src/ so they can reach across packages without
      // tripping the @workspace/vndrly tsconfig include.
      "tests/**/*.spec.ts",
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(
        import.meta.dirname,
        "..",
        "..",
        "attached_assets",
      ),
    },
  },
  // Stub out CSS + image asset imports so component files (which pull in
  // tailwind/css side-effect imports and PNG header images) can mount in
  // jsdom without bundling actual binary assets.
  assetsInclude: [],
});
