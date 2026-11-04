// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  REPOSITORY_DISABLE_PATH,
  REPOSITORY_ENABLE_PATH,
  repositoryEnabledResponseSchema,
  repositoryEnableRequestSchema,
} from './repository-enabled.ts';

test('the path names the repository by its row id and no installation', () => {
  expect(REPOSITORY_ENABLE_PATH).toBe('/api/repositories/:repositoryId/enable');
});

test('the disable path names the repository by its row id and no installation, like the enable path (E14-S04)', () => {
  expect(REPOSITORY_DISABLE_PATH).toBe('/api/repositories/:repositoryId/disable');
});

test.each([
  ['no body', undefined],
  ['null', null],
  ['an empty object', {}],
])('%s is an empty body', (_label, body) => {
  expect(repositoryEnableRequestSchema.safeParse(body).success).toBe(true);
});

test.each([
  ['a key nobody defined', { installationId: 1 }],
  ['a document id', { documentId: 7 }],
  ['text', 'enable'],
  ['a list', []],
  ['a number', 1],
])('%s is not an empty body', (_label, body) => {
  expect(repositoryEnableRequestSchema.safeParse(body).success).toBe(false);
});

test.each([
  ['no body', undefined, true],
  ['null', null, true],
  ['an empty object', {}, true],
  ['a key nobody defined', { installationId: 1 }, false],
  ['a flag', { enabled: true }, false],
])('the body of the calls (disable included, E14-S04) takes %s: an empty body only', (_label, body, accepted) => {
  expect(repositoryEnableRequestSchema.safeParse(body).success).toBe(accepted);
});

test('the answer is whether the repository enforces now and whether the call changed it, both required', () => {
  expect(repositoryEnabledResponseSchema.parse({ enabled: true, changed: true })).toEqual({
    enabled: true,
    changed: true,
  });
  expect(repositoryEnabledResponseSchema.parse({ enabled: false, changed: false })).toEqual({
    enabled: false,
    changed: false,
  });
  expect(repositoryEnabledResponseSchema.safeParse({ enabled: true }).success).toBe(false);
  expect(repositoryEnabledResponseSchema.safeParse({ changed: true }).success).toBe(false);
});
