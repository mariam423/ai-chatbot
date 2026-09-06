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
  {
    // Test mocks name unused mock-fn arguments with a `_` prefix on purpose —
    // the arguments exist so the fake has the right arity/shape. The project
    // convention is a leading underscore, not the default argsIgnorePattern.
    // Note: `no-console` is already off (prettier preset), so the removed
    // per-line disables are gone and the debug `console.log` calls in
    // `tests/_prisma-mock.ts` are intentional test diagnostics.
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
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
    // Local database data directories (dev-only, gitignored): traversing the
    // Postgres catalog / Redis dump makes `eslint .` hang.
    '.pg/**',
    '.redis/**',
  ]),
])

export default eslintConfig
