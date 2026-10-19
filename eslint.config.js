'use strict';

// Only the mistakes worth failing a build over: unused variables, accidental globals, `==`.
const js = require('@eslint/js');
const globals = require('globals');

const rules = {
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
  'no-undef': 'error',
  eqeqeq: ['error', 'always', { null: 'ignore' }]
};

module.exports = [
  { ignores: ['node_modules/**', 'uploads/**', 'demo/**', 'db/**', 'e2e/node_modules/**'] },
  { ...js.configs.recommended, files: ['**/*.js', '**/*.mjs'] },
  { files: ['server.js', 'server/**/*.js', 'scripts/**/*.js', 'eslint.config.js'], languageOptions: { sourceType: 'commonjs', globals: globals.node }, rules },
  { files: ['test/*.test.js'], languageOptions: { sourceType: 'commonjs', globals: globals.node }, rules },
  { files: ['test/autofill.test.js', 'test/innerhtml.test.js'], languageOptions: { sourceType: 'module', globals: globals.node } }, // the two ES-module tests
  { files: ['public/js/**/*.js'], languageOptions: { sourceType: 'module', globals: globals.browser }, rules },
  { files: ['e2e/*.mjs'], languageOptions: { sourceType: 'module', globals: globals.node }, rules }
];
