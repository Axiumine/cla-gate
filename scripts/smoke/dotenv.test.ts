// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { withSettings } from './dotenv.ts';

// E19-S08: the dotenv file of a smoke stack takes the test's settings and keeps everything else as init-secrets.sh made it.

const BASE = '# Origin\nPUBLIC_BASE_URL=\n\nPORT=3000\nLOG_LEVEL=info\n';

test('a setting replaces the value of its line in place', () => {
  expect(withSettings(BASE, { PORT: '41000' })).toBe('# Origin\nPUBLIC_BASE_URL=\n\nPORT=41000\nLOG_LEVEL=info\n');
});

test('a setting with no line is added at the end', () => {
  expect(withSettings(BASE, { LOG_LEVEL_EXTRA: 'debug' })).toBe(`${BASE}LOG_LEVEL_EXTRA=debug\n`);
});

test('every line of a repeated name is replaced, because compose reads the last one', () => {
  expect(withSettings('PORT=1\nX=1\nPORT=2\n', { PORT: '9' })).toBe('PORT=9\nX=1\nPORT=9\n');
});

test('a comment that looks like an assignment is not one', () => {
  expect(withSettings('# PORT=1\n', { PORT: '9' })).toBe('# PORT=1\nPORT=9\n');
});

test('a value that holds an equals sign is written whole', () => {
  expect(withSettings('A=\n', { A: 'x=y' })).toBe('A=x=y\n');
});

test('no settings leave the text as it was, with one final line break', () => {
  expect(withSettings(BASE, {})).toBe(BASE);
  expect(withSettings('A=1', {})).toBe('A=1\n');
});

test('a name is matched whole: PORT does not touch CADDY_HTTP_PORT', () => {
  expect(withSettings('CADDY_HTTP_PORT=80\n', { PORT: '9' })).toBe('CADDY_HTTP_PORT=80\nPORT=9\n');
});
