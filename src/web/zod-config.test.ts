// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { z } from 'zod';
import './zod-config.ts';

// E17-S03: Zod never compiles a parser in the browser, which the page's Content-Security-Policy (no `unsafe-eval`) would report
// as a violation. That no `Function` is constructed while the schemas of src/shared are built is proved in a fresh process by
// scripts/web/zod-jitless.test.ts; this is the setting itself.

test('Zod is set to jitless for the whole app: it reads the setting each time it builds a schema', () => {
  expect(z.config().jitless).toBe(true);
});
