// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import { readText } from '../ci/lib/test-support.ts';
import { listNames } from './files.ts';
import { reconfigure } from './reconfigure.ts';
import { startStack } from './stack.ts';
import { scripted, track } from './test-support.ts';

// E19-S12: what the operator does after the setup, to the files of a real (temporary) stack directory made by the real
// scripts/init-secrets.sh.

const DOTENV = '.env';

async function stackWithFiles() {
  const { deps } = scripted();
  return track(await startStack(deps, { scenario: 'boot' }));
}

const secretPath = (directory: string, name: string): string => path.join(directory, 'secrets', name);

test('a secret file is replaced by a read-only one with the new content and a line break, and no temporary file stays behind', async () => {
  const stack = await stackWithFiles();
  const file = secretPath(stack.directory, 'github_webhook_secret');
  expect(readText(file)).toBe('');
  reconfigure(stack, { secrets: { github_webhook_secret: 'made-up-webhook-secret' } });
  expect(readText(file)).toBe('made-up-webhook-secret\n');
  expect(stack.secret('github_webhook_secret')).toBe('made-up-webhook-secret');
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: a path inside a temporary directory the test made
  expect(fs.statSync(file).mode & 0o777).toBe(0o444);
  expect(listNames(path.join(stack.directory, 'secrets')).filter((name) => name.startsWith('.'))).toEqual([]);
});

test('the other secret files stay as they were', async () => {
  const stack = await stackWithFiles();
  const before = stack.secret('session_secret');
  reconfigure(stack, { secrets: { github_client_secret: 'x' } });
  expect(stack.secret('session_secret')).toBe(before);
  expect(stack.secret('github_app_private_key')).toBe('');
});

test('a setting is written to the dotenv file in place, and the other lines and comments are untouched', async () => {
  const stack = await stackWithFiles();
  const dotenv = path.join(stack.directory, DOTENV);
  const before = readText(dotenv).split('\n');
  reconfigure(stack, { settings: { GITHUB_APP_ID: '123456', GITHUB_CLIENT_ID: 'Iv1.abc' } });
  const after = readText(dotenv).split('\n');
  expect(after).toContain('GITHUB_APP_ID=123456');
  expect(after).toContain('GITHUB_CLIENT_ID=Iv1.abc');
  expect(after.filter((line) => line.startsWith('GITHUB_APP_ID='))).toHaveLength(1);
  expect(after.filter((line) => !line.startsWith('GITHUB_'))).toEqual(
    before.filter((line) => !line.startsWith('GITHUB_')),
  );
});

test('a change with nothing in it changes nothing', async () => {
  const stack = await stackWithFiles();
  const dotenv = path.join(stack.directory, DOTENV);
  const before = readText(dotenv);
  reconfigure(stack, {});
  expect(readText(dotenv)).toBe(before);
});

test('a secret that has no file is refused before anything is written, because compose would not mount it', async () => {
  const stack = await stackWithFiles();
  const dotenv = path.join(stack.directory, DOTENV);
  const before = readText(dotenv);
  expect(() => {
    reconfigure(stack, { settings: { GITHUB_APP_ID: '1' }, secrets: { github_webhook_secret: 'x', invented: 'y' } });
  }).toThrow('secrets/invented does not exist, so compose does not mount it');
  expect(readText(dotenv)).toBe(before);
  expect(stack.secret('github_webhook_secret')).toBe('');
});

test('a setting that the stack fixes in the environment of every compose call is refused, because it would be shadowed', async () => {
  const stack = await stackWithFiles();
  expect(() => {
    reconfigure(stack, { settings: { PORT: '1', PUBLIC_BASE_URL: 'https://x.example', GITHUB_APP_ID: '1' } });
  }).toThrow('PORT, PUBLIC_BASE_URL is fixed by the stack and cannot be changed');
  expect(readText(path.join(stack.directory, DOTENV))).not.toContain('GITHUB_APP_ID=1');
});
