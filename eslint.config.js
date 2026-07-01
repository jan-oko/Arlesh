import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import i18next from "eslint-plugin-i18next";

/** True for style-property values that are compile-time constants (so they belong in CSS). */
function isStaticStyleValue(node) {
  switch (node.type) {
    case "Literal":
      return true;
    case "UnaryExpression":
      return isStaticStyleValue(node.argument);
    case "TemplateLiteral":
      return node.expressions.length === 0;
    default:
      return false;
  }
}

// Local rule: a `style={{ ... }}` whose every value is a literal is really static CSS and should
// live in a CSS module. Dynamic styles (any variable/expression/computed value) are allowed;
// justify a genuine exception with `// eslint-disable-next-line local/no-static-inline-style`.
const localPlugin = {
  rules: {
    "no-static-inline-style": {
      meta: {
        type: "suggestion",
        messages: {
          static: "Static inline style — move it to a CSS module class (tokens.css).",
        },
      },
      create(context) {
        return {
          JSXAttribute(node) {
            if (node.name.name !== "style") return;
            const value = node.value;
            if (value == null || value.type !== "JSXExpressionContainer") return;
            const expr = value.expression;
            if (expr.type !== "ObjectExpression" || expr.properties.length === 0) return;
            const allStatic = expr.properties.every(
              (property) =>
                property.type === "Property" &&
                !property.computed &&
                isStaticStyleValue(property.value),
            );
            if (allStatic) context.report({ node, messageId: "static" });
          },
        };
      },
    },
  },
};

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      i18next,
      local: localPlugin,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "local/no-static-inline-style": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "i18next/no-literal-string": [
        "error",
        {
          mode: "jsx-text-only",
          "jsx-attributes": {
            include: ["placeholder", "aria-label", "alt", "title"],
            exclude: ["className", "style", "type", "id", "href", "src", "key", "data-*", "dir"],
          },
        },
      ],
    },
  },
);
