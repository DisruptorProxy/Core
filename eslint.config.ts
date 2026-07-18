import azeroth from '@azerothjs/eslint-plugin';

import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
    globalIgnores([
        '**/dist/**',
        '**/node_modules/**',
        '**/build/**',
        '**/out/**',
        '**/.intellijPlatform/**',
        '**/.azeroth/**'
    ]),
    tseslint.configs.recommended,
    {
        files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
        plugins:
        {
            js,
            azeroth
        },
        extends: ['js/recommended'],
        languageOptions: { globals: globals.browser },
        rules:
        {
            'no-undef': 'off',

            // TypeScript handles overloaded function signatures
            // natively; the base ESLint rule flags the overload
            // forms as redeclarations.
            'no-redeclare': 'off',

            'space-before-blocks': 'error',
            'quotes': ['error', 'single', { avoidEscape: true }],
            'key-spacing': 'error',
            'semi-spacing': 'error',
            'curly': ['error', 'all'],
            'indent': ['error', 4, { SwitchCase: 1 }],
            'semi': ['error', 'always'],
            'brace-style': ['error', 'allman'],
            'block-spacing': ['error', 'always'],
            'object-curly-spacing': ['error', 'always'],
            'template-curly-spacing': ['error', 'always'],
            'comma-dangle': ['error', 'never'],
            'no-multiple-empty-lines':
            [
                'error',
                {
                    max: 1,
                    maxEOF: 0,
                    maxBOF: 0
                }
            ],
            'no-trailing-spaces': 'error',
            'linebreak-style': ['error', 'unix'],
            'no-unused-vars': 'off',

            '@typescript-eslint/explicit-member-accessibility':
            [
                'error',
                {
                    accessibility: 'explicit',
                    overrides:
                    {
                        constructors: 'no-public'
                    }
                }
            ],
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/explicit-function-return-type': ['warn', { allowExpressions: true, allowTypedFunctionExpressions: true }],
            '@typescript-eslint/no-unused-vars':
            [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    destructuredArrayIgnorePattern: '^_'
                }
            ],
            '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],

            'azeroth/no-self-write-in-effect': 'warn',
            'azeroth/require-effect-disposal': 'warn',
            'azeroth/handler-call': 'warn'
        }
    },
    {
        files: ['**/*.{js,mjs,cjs}'],
        rules:
        {
            '@typescript-eslint/explicit-function-return-type': 'off'
        }
    },
    {
        files: ['**/*.spec.ts', '**/tests/**/*.ts'],
        rules:
        {
            '@typescript-eslint/explicit-function-return-type': 'off'
        }
    },

    // Makes `.azeroth` a first-class lint target: the processor projects each
    // component to its virtual TypeScript, maps messages back to the original
    // source, and tunes what does not survive the projection. Must stay last.
    ...azeroth.configs.recommended,
    {
        // The processor lints each component as the virtual block
        // `<file>.azeroth/0.ts`, so adjustments target that name.
        files: ['**/*.azeroth/*.ts'],
        rules:
        {
            // A `component` block has no return-type position - the compiler
            // decides what it returns - so the rule can never be satisfied on
            // one. Plain functions in the module are covered by `azeroth-tsc`.
            '@typescript-eslint/explicit-function-return-type': 'off'
        }
    }
]);
