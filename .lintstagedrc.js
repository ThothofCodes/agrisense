// AgriSense Smart Farming System
// Copyright (c) 2026 Ruai Tech Solutions. All rights reserved.
// Author: Thoth of Codes
// Licensed under the MIT License — see LICENSE file in the project root.

module.exports = {
  // ── TypeScript / JavaScript ────────────────────────────────────────────────
  '*.{ts,tsx,js,jsx}': [
    'eslint --fix --max-warnings 0',
    'prettier --write',
  ],

  // ── Python ─────────────────────────────────────────────────────────────────
  '*.py': [
    'flake8 --count --statistics',
  ],

  // ── Styles ─────────────────────────────────────────────────────────────────
  '*.{css,scss}': [
    'prettier --write',
  ],

  // ── JSON / YAML / Markdown ─────────────────────────────────────────────────
  '*.{json,yaml,yml,md}': [
    'prettier --write',
  ],

  // ── Dockerfiles ────────────────────────────────────────────────────────────
  // Note: requires `hadolint` binary (https://github.com/hadolint/hadolint)
  // 'Dockerfile*': [
  //   'hadolint',
  // ],
};
