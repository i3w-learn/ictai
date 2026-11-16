import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/",
      "**/dist/",
      "**/target/",
      "**/gen/",
      "**/.data/",
      "stage/",
      "installer/",
      ".docker-data/",
      ".worktrees/",
      ".playwright-mcp/",
      // Local browser-test shims, not part of the app.
      "apps/client/vite.e2e.config.ts",
      "apps/client/vite.harness.config.ts",
      "apps/client/src/e2e-driver.ts",
      "apps/client/src/harness.tsx",
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      // Names starting with "_" are unused on purpose.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["server/**", "contracts/**", "docker/**", "apps/client/*.ts"],
    languageOptions: { globals: globals.node },
  },
  {
    // Tests read loose JSON replies, where `any` is the honest type.
    files: ["**/test/**", "**/*.test.ts", "**/*.test.tsx"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    files: ["apps/client/src/**"],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
);
