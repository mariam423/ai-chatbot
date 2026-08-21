import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import prettier from 'eslint-config-prettier'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Turn off ESLint rules that conflict with Prettier formatting.
  prettier,
  {
    // Vendor-provided Codebuff agent type definitions use `any`/empty
    // object types by design; they are upstream files, not project code.
    files: ['.agents/types/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Build/test artifacts:
    'test-results/**',
    'playwright-report/**',
    'coverage/**',
  ]),
])

export default eslintConfig
