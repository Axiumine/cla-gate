// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { signContextScope } from './sign-queries.ts';

// E18-S01: the scope of the sign contexts of one repository in the query cache (the full keys are pinned in SignPage.test.tsx).

test('the scope names the repository, and two repositories never share one', () => {
  expect(signContextScope(123)).toEqual(['sign', 'context', 123]);
  expect(signContextScope(1)).not.toEqual(signContextScope(2));
});
