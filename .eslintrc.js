'use strict';
// This file exists solely for DeepSource's JavaScript analyzer.
// DeepSource reads legacy .eslintrc.* config to determine parser options.
// ESLint 9 (used in frontend/) ignores this file when eslint.config.js is present.
module.exports = {
  parserOptions: {
    sourceType: 'module',
    ecmaVersion: 2022,
    ecmaFeatures: {
      jsx: true,
    },
  },
  env: {
    browser: true,
    es2022: true,
    node: true,
  },
};
