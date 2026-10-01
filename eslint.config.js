import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.worker },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Underscore-prefixed bindings are intentional: the destructure-to-omit
      // idiom (`const { [id]: _removed, ...rest } = map`) is the cleanest way to
      // drop a computed key from an object.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Design tokens, chart constants, and class-variance definitions are
    // deliberately co-located with the components that own them. The rule only
    // affects hot-reload granularity in development, not correctness.
    files: [
      'src/components/ui/*.tsx',
      'src/components/charts/primitives.tsx',
    ],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
);
