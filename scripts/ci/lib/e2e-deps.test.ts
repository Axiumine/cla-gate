// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import os from 'node:os';
import process from 'node:process';
import { expect, test } from 'vitest';
import { runChild } from '../../dev/lib/child-runner.ts';
import { systemDeps } from './e2e-deps.ts';
import { realExec } from './exec.ts';
import { systemDeps as postgresDeps } from './postgres-deps.ts';

test('the real dependencies stream the command, share the postgres helper randomness and file append, and use docker on PATH', () => {
  expect(systemDeps.run).toBe(runChild);
  expect(systemDeps.exec).toBe(realExec);
  expect(systemDeps.randomHex).toBe(postgresDeps.randomHex);
  expect(systemDeps.appendFile).toBe(postgresDeps.appendFile);
});

test('the working directory is the one of this process', () => {
  expect(systemDeps.cwd()).toBe(process.cwd());
});

test('the user is the one running this process, as numbers', () => {
  const { uid, gid } = os.userInfo();
  expect(systemDeps.user()).toEqual({ uid, gid });
});
