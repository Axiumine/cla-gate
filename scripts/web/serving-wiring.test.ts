// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { z } from 'zod';
import { repoText } from '../semgrep-rules/test-support.ts';

// E17-S03: the packages that serve the app, and the one that must never be there.

const manifest = z
  .object({ dependencies: z.record(z.string(), z.string()), devDependencies: z.record(z.string(), z.string()) })
  .parse(JSON.parse(repoText('package.json')));

test('@fastify/static is a runtime dependency of the server, not a development one', () => {
  expect(Object.keys(manifest.dependencies)).toContain('@fastify/static');
  expect(Object.keys(manifest.devDependencies)).not.toContain('@fastify/static');
});

test('no CORS package is installed: the app and the API share one origin and no other origin may read them', () => {
  const names = [...Object.keys(manifest.dependencies), ...Object.keys(manifest.devDependencies)];
  expect(names.filter((name) => /(^|\/)cors$/.test(name))).toEqual([]);
});
