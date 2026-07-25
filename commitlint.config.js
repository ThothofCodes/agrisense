// AgriSense Smart Farming System
// Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
// Author: Thoth of Codes
// Licensed under the MIT License — see LICENSE file in the project root.

module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // ── Scope rules ──────────────────────────────────────────────────────────
    'scope-case': [2, 'always', 'kebab-case'],
    'scope-enum': [
      2,
      'always',
      ['api', 'web', 'ml', 'infra', 'ci', 'deps', 'docs', 'db', 'scripts'],
    ],

    // ── Subject rules ────────────────────────────────────────────────────────
    'subject-case': [2, 'never', ['start-case', 'pascal-case', 'upper-case']],
    'subject-full-stop': [2, 'never', '.'],
    'subject-empty': [2, 'never'],

    // ── Type rules ───────────────────────────────────────────────────────────
    'type-enum': [
      2,
      'always',
      [
        'feat',     // A new feature
        'fix',      // A bug fix
        'docs',     // Documentation only changes
        'style',    // Changes that do not affect the meaning of the code
        'refactor', // A code change that neither fixes a bug nor adds a feature
        'perf',     // A code change that improves performance
        'test',     // Adding missing or correcting existing tests
        'build',    // Changes affecting the build system or external dependencies
        'ci',       // Changes to CI configuration files and scripts
        'chore',    // Other changes that don't modify src or test files
        'revert',   // Reverts a previous commit
      ],
    ],

    // ── Body & footer rules ─────────────────────────────────────────────────
    'body-leading-blank': [2, 'always'],
    'footer-leading-blank': [2, 'always'],

    // ── Max lengths ──────────────────────────────────────────────────────────
    'header-max-length': [2, 'always', 72],
    'body-max-line-length': [2, 'always', 100],
  },

  // ── Custom parser options ─────────────────────────────────────────────────
  parserPreset: {
    parserOpts: {
      headerPattern: /^(\w*)(?:\(([\w$.\-*/ ]*)\))?: (.*)$/,
      headerCorrespondence: ['type', 'scope', 'subject'],
    },
  },

  // ── Help message ──────────────────────────────────────────────────────────
  helpUrl:
    'https://github.com/thoth-codes/agrisense/blob/main/CONTRIBUTING.md#commit-conventions',
};
