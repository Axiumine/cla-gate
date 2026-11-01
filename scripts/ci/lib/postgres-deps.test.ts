// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { PORT_MAX, PORT_MIN } from './ports.ts';
import { systemDeps } from './postgres-deps.ts';
import { readText } from './test-support.ts';

test('the system dependencies are real: randomness, clock, sleep, a loopback port and appending to a file', async () => {
  expect(systemDeps.randomHex(24)).toMatch(/^[0-9a-f]{48}$/);
  expect(systemDeps.randomHex(24)).not.toBe(systemDeps.randomHex(24));
  expect(Math.abs(systemDeps.now() - Date.now())).toBeLessThan(1000);
  await systemDeps.sleep(1);
  const port = await systemDeps.pickPort();
  expect(port).toBeGreaterThanOrEqual(PORT_MIN);
  expect(port).toBeLessThanOrEqual(PORT_MAX);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ci-postgres-')), 'env');
  systemDeps.appendFile(file, 'A=1\n');
  systemDeps.appendFile(file, 'B=2\n');
  expect(readText(file)).toBe('A=1\nB=2\n');
  fs.rmSync(path.dirname(file), { recursive: true });
});
