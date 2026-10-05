import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  { ignores: ['dist/**', 'node_modules/**', '.wrangler/**'] },

  js.configs.recommended,

  {
    files: ['**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // Without this, every component rendered in JSX reads as an unused
      // import, which buries the real findings.
      ...react.configs.flat.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',

      // The bug that shipped a blank page: a component referenced INPUT,
      // which was never defined anywhere. no-undef catches it at lint time.
      'no-undef': 'error',

      // A leftover copy of a removed constant is often the other half of a
      // rename gone wrong.
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],

      // Data loading on mount legitimately sets state after an await, which
      // this rule flags on every page in the app. Left on as a warning.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },

  {
    // Scripts and the Worker are plain Node ESM, not browser React.
    files: ['scripts/**/*.mjs', 'worker/**/*.js', 'eslint.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-undef': 'error',
    },
  },
];