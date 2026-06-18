// skipcq: JS-0833
import js from '@eslint/js';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y';

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      'jsx-a11y': jsxA11yPlugin,
    },
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        MutationObserver: 'readonly',
        FormData: 'readonly',
        Blob: 'readonly',
        File: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        localStorage: 'readonly',
        sessionStorage: 'readonly',
        navigator: 'readonly',
        location: 'readonly',
        history: 'readonly',
        Event: 'readonly',
        CustomEvent: 'readonly',
        URLSearchParams: 'readonly',
        performance: 'readonly',
        Number: 'readonly',
        Math: 'readonly',
        JSON: 'readonly',
        Date: 'readonly',
        Array: 'readonly',
        Object: 'readonly',
        String: 'readonly',
        Boolean: 'readonly',
        Promise: 'readonly',
        Error: 'readonly',
        Map: 'readonly',
        Set: 'readonly',
        Symbol: 'readonly',
        parseInt: 'readonly',
        parseFloat: 'readonly',
        isNaN: 'readonly',
        isFinite: 'readonly',
        encodeURIComponent: 'readonly',
        decodeURIComponent: 'readonly',
        process: 'readonly',
        globalThis: 'readonly',
        import: 'readonly',
        atob: 'readonly',
        btoa: 'readonly',
        structuredClone: 'readonly',
        AbortController: 'readonly',
        Headers: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        WebSocket: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
        prompt: 'readonly',
        HTMLElement: 'readonly',
        Image: 'readonly',
        queueMicrotask: 'readonly',
        ResizeObserver: 'readonly',
        IntersectionObserver: 'readonly',
        getComputedStyle: 'readonly',
        crypto: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      // React
      ...reactPlugin.configs.recommended.rules,
      'react/prop-types': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/jsx-no-target-blank': 'warn',
      'react/no-unknown-property': 'warn',
      // Stylistic — not a correctness rule; off so quotes/apostrophes in copy don't fail the gate.
      'react/no-unescaped-entities': 'off',
      // #232 guard: forbid fresh object/array/fn literals passed as Context Provider value.
      'react/jsx-no-constructed-context-values': 'error',

      // React Hooks
      ...reactHooksPlugin.configs.recommended.rules,

      // Accessibility — #239 guard: enforced as errors.
      'jsx-a11y/label-has-associated-control': 'error',
      'jsx-a11y/no-noninteractive-element-interactions': 'error',
      'jsx-a11y/click-events-have-key-events': 'error',
      'jsx-a11y/no-static-element-interactions': 'error',
      'jsx-a11y/interactive-supports-focus': 'warn',
      'jsx-a11y/aria-props': 'error',
      'jsx-a11y/aria-proptypes': 'error',
      'jsx-a11y/aria-unsupported-elements': 'error',
      'jsx-a11y/role-has-required-aria-props': 'error',
      'jsx-a11y/role-supports-aria-props': 'error',

      // General
      'no-unused-vars': ['warn', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      // Allow intentional empty catch blocks (best-effort cleanup / non-critical I/O).
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // Single-source the axios instance: ban `axios.create(...)` everywhere except the
    // shared HTTP client modules. New per-module clients would bypass the auth/refresh
    // interceptor chain. (#232/#237 guard.)
    files: ['src/**/*.{js,jsx}'],
    ignores: ['src/services/api/axiosClient.js', 'src/services/api/adapters/httpAdapter.js'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.name='axios'][callee.property.name='create']",
          message:
            'Do not call axios.create outside the shared client (src/api/axiosClient.js). Import the shared instance instead so the auth/refresh interceptors apply.',
        },
      ],
    },
  },
  {
    // Ignore build artifacts and test fixtures
    ignores: ['dist/**', 'node_modules/**', '*.config.js'],
  },
];
