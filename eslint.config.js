// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["dist/**", ".astro/**", "node_modules/**", "src/env.d.ts"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
  },
  {
    // ビルド成果物を検証するNode CLIスクリプト。ブラウザ/Worker向けの型定義ではなく
    // Node.jsのグローバルを使うため、このディレクトリだけ個別にglobalsを宣言する。
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        fetch: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        Buffer: "readonly",
        WebAssembly: "readonly",
      },
    },
  },
  {
    // LGPL候補ソースパッケージのend-to-endリビルド検証
    // (.github/workflows/verify-lgpl-heic-source-rebuild.yml)専用のNode CLIスクリプト。
    // 通常CIには組み込まれない、手動/PR workflowだけが実行する検証ヘルパー。
    files: [".github/workflows/verify-lgpl-heic-source-rebuild/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        WebAssembly: "readonly",
      },
    },
  },
  eslintConfigPrettier,
);
