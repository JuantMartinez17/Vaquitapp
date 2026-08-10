/**
 * Conventional Commits, enforced on every commit via the `commit-msg` hook.
 *
 * Format:  type(scope): subject
 * Example: feat(expenses): add percentage split strategy
 *
 * See CODESTYLE.md for the full convention.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Allowed types. `chore` is intentionally last-resort: prefer a precise type.
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'refactor',
        'perf',
        'docs',
        'test',
        'build',
        'ci',
        'style',
        'revert',
        'chore',
      ],
    ],
    // Scope is optional, but when present it must be a module or area name.
    'scope-case': [2, 'always', 'kebab-case'],
    // Subject: imperative mood, lowercase, no trailing period.
    'subject-case': [2, 'always', 'lower-case'],
    'subject-full-stop': [2, 'never', '.'],
    'subject-empty': [2, 'never'],
    'header-max-length': [2, 'always', 72],
    'body-max-line-length': [2, 'always', 100],
  },
};
