import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      // Render React Native primitives via react-native-web so component
      // tests run in jsdom without needing the native bridge.
      { find: /^react-native$/, replacement: "react-native-web" },
      { find: /^@\/(.+)/, replacement: path.resolve(__dirname, "$1") },
    ],
  },
  define: {
    __DEV__: "true",
  },
  test: {
    // node for pure logic tests; jsdom for component tests. We use jsdom
    // for everything since the helper tests don't touch the DOM and the
    // overhead is negligible.
    environment: "jsdom",
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "lib/**/*.test.ts",
      "components/**/*.test.tsx",
      "app/**/*.test.tsx",
    ],
  },
});
