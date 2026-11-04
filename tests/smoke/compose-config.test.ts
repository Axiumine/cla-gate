// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { output } from '../../scripts/smoke/probe.ts';
import { connect } from '../../scripts/smoke/stack.ts';
import { stackDeps } from '../../scripts/smoke/system.ts';
import { stack } from './support.ts';

// E19-S08: the compose file is valid for the default profile and for `tls`, read the way the operator's `docker compose`
// reads it: with the secrets and the dotenv file that scripts/init-secrets.sh and the smoke test made beside it.

test.each([
  ['the default profile', ''],
  ['the tls profile', 'tls'],
])('docker compose config --quiet accepts %s', async (_name, profiles) => {
  const result = await connect(stackDeps, { ...stack, profiles }).compose(['config', '--quiet']);
  expect(result.code, output(result)).toBe(0);
});
