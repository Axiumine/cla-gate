// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// eslint-plugin-no-unsanitized ships no types. This is the part of its API that eslint.config.mjs uses.
declare module 'eslint-plugin-no-unsanitized' {
  import type { Linter } from 'eslint';

  const plugin: { readonly configs: { readonly recommended: Linter.Config } };
  export default plugin;
}
