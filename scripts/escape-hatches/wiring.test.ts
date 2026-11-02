// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';
import { readText } from '../ci/lib/test-support.ts';

// E20-S16: the gate only protects anything when it runs where the other static checks run.

const ROOT = path.resolve(import.meta.dirname, '../..');

function readYaml(file: string): unknown {
  const parsed: unknown = parse(readText(path.join(ROOT, file)));
  return parsed;
}

const packageSchema = z.object({ scripts: z.record(z.string(), z.string()) });
const { scripts } = packageSchema.parse(JSON.parse(readText(path.join(ROOT, 'package.json'))));

const hookJobSchema = z.object({ name: z.string(), run: z.string().optional() });
const groupSchema = z.object({ name: z.string(), group: z.object({ jobs: z.array(hookJobSchema) }) });
const lefthookSchema = z.object({ 'pre-push': z.object({ jobs: z.array(z.union([groupSchema, hookJobSchema])) }) });
const ciSchema = z.object({
  jobs: z.record(z.string(), z.object({ steps: z.array(z.object({ name: z.string(), run: z.string().optional() })) })),
});

test('yarn lint:hatches runs the script, and yarn lint runs yarn lint:hatches after Biome and ESLint', () => {
  expect(scripts['lint:hatches']).toBe('node scripts/check-escape-hatches.ts');
  expect(scripts['lint']).toBe('yarn lint:biome && yarn lint:eslint && yarn lint:hatches');
});

test('the pre-push hook, and so yarn gate, runs the script in the static-analysis group', () => {
  const jobs = lefthookSchema.parse(readYaml('lefthook.yml'))['pre-push'].jobs;
  const group = jobs.flatMap((job) => ('group' in job && job.name === 'static-analysis' ? [job.group] : []))[0];
  expect(group?.jobs.find((job) => job.name === 'escape-hatches')?.run).toBe('yarn lint:hatches');
});

test('the CI static job runs the script', () => {
  const steps = ciSchema.parse(readYaml('.github/workflows/ci.yml')).jobs['static']?.steps;
  expect(steps?.find((step) => step.run === 'yarn lint:hatches')?.name).toBe('Escape hatches (justification gate)');
});
