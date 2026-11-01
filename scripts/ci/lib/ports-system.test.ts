// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';

// The system picker must draw from the whole range, upper end included (crypto.randomInt excludes its maximum).
const draws = vi.hoisted(() => ({ next: 40_000 }));

vi.mock('node:crypto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:crypto')>()),
  randomInt: vi.fn(() => draws.next++),
}));

test('pickSystemFreePort draws from 32769 up to and including 60999', async () => {
  const { randomInt } = await import('node:crypto');
  const { pickSystemFreePort } = await import('./ports.ts');
  const port = await pickSystemFreePort();
  expect(port).toBeGreaterThanOrEqual(40_000);
  expect(vi.mocked(randomInt)).toHaveBeenNthCalledWith(1, 32_769, 61_000);
});
