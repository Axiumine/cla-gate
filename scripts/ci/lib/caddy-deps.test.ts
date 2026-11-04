// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { systemDeps } from './caddy-deps.ts';
import { systemDeps as e2eDeps } from './e2e-deps.ts';
import { realExec } from './exec.ts';
import { systemDeps as postgresDeps } from './postgres-deps.ts';
import { exists, readText } from './test-support.ts';

test('the real dependencies use docker on PATH and share the randomness, file append and user lookup of the other helpers', () => {
  expect(systemDeps.exec).toBe(realExec);
  expect(systemDeps.randomHex).toBe(postgresDeps.randomHex);
  expect(systemDeps.appendFile).toBe(postgresDeps.appendFile);
  expect(systemDeps.user).toBe(e2eDeps.user);
});

test('the Caddyfile is the one of this checkout: absolute, existing, and the file the compose stack mounts', () => {
  expect(path.isAbsolute(systemDeps.caddyfile)).toBe(true);
  expect(systemDeps.caddyfile.endsWith(`${path.sep}docker${path.sep}Caddyfile`)).toBe(true);
  expect(exists(systemDeps.caddyfile)).toBe(true);
  expect(readText(systemDeps.caddyfile)).toContain('reverse_proxy app:3000');
});
