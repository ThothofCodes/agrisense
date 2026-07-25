module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { node: true, es2022: true, jest: true },
  ignorePatterns: ['dist', 'node_modules', 'coverage'],
  rules: {
    // Pragmatic for a fast-moving API codebase — correctness over style purity.
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    'no-empty': ['warn', { allowEmptyCatch: true }],
    '@typescript-eslint/no-non-null-assertion': 'off',
    'no-console': 'off',
    'no-case-declarations': 'off',
    // Express's official type-augmentation pattern (`declare global { namespace
    // Express { interface Request {...} } }`) requires `namespace` — there is
    // no ES2015-module equivalent for extending a third-party ambient global.
    // Used exactly once, in middleware/auth.ts.
    '@typescript-eslint/no-namespace': 'off',
  },
};
