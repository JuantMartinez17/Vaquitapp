import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'src/generated/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // ── Application source: type-aware rules ──────────────────────────────────
  // These need the TypeScript program, so they only run on files inside
  // tsconfig's `include` (src/**). See CODESTYLE.md § Debuggable code.
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // An unawaited promise fails silently and leaves the request hanging.
      // node:test's describe/it return promises the runner already tracks.
      '@typescript-eslint/no-floating-promises': [
        'error',
        {
          allowForKnownSafeCalls: [
            {
              from: 'package',
              package: 'node:test',
              name: [
                'describe',
                'it',
                'test',
                'suite',
                'before',
                'after',
                'beforeEach',
                'afterEach',
              ],
            },
          ],
        },
      ],
      // Catches `async` handlers passed where a sync callback is expected
      // (an Express route without asyncHandler swallows the rejection).
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      // Errors must carry context; a bare string throw has no stack.
      '@typescript-eslint/only-throw-error': 'error',

      // Logs go through pino so they are structured and queryable.
      'no-console': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-restricted-globals': [
        'error',
        {
          name: 'parseFloat',
          message: 'Money never goes through floats. Use Decimal (utils/money.ts).',
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Number',
          property: 'parseFloat',
          message: 'Money never goes through floats. Use Decimal (utils/money.ts).',
        },
      ],
    },
  },

  // ── Bootstrap and CLI: console is the only logger available ───────────────
  // config.ts fails before pino is configured; server.ts logs start/stop.
  {
    files: ['src/server.ts', 'src/app/config.ts'],
    rules: { 'no-console': 'off' },
  },

  // ── Domain layer must stay pure ───────────────────────────────────────────
  // Split, balance and money logic is testable without HTTP or a database.
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['express', 'express/*'],
              message: 'The domain layer must not know about HTTP.',
            },
            {
              group: ['@prisma/client', '**/generated/prisma/**', '**/infrastructure/**'],
              message: 'The domain layer must not know about persistence.',
            },
          ],
        },
      ],
    },
  },

  // ── Standalone Node scripts outside tsconfig's program ────────────────────
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { process: 'readonly' },
    },
  },

  eslintConfigPrettier,
);
