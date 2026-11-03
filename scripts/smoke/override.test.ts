// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';
import { readText } from '../ci/lib/test-support.ts';
import { stackNames } from './names.ts';
import { overrideFor } from './override.ts';
import { ROOT } from './test-support.ts';

// E19-S08: the compose override of a smoke stack labels everything the real docker-compose.yml declares and changes nothing else.

const COMPOSE = readText(path.join(ROOT, 'docker-compose.yml'));
const NAMES = stackNames('cla-smoke-77-1', 'boot');
const LABELS = { 'cla-gate.ci': 'container', 'cla-gate.run': 'cla-smoke-77-1' };
const CONTEXT = '/work/checkout';

const resourceSchema = z.object({
  labels: z.record(z.string(), z.string()),
  image: z.string().optional(),
  build: z
    .object({ context: z.string(), labels: z.record(z.string(), z.string()) })
    .strict()
    .optional(),
});
const fileSchema = z.object({
  services: z.record(z.string(), resourceSchema),
  networks: z.record(z.string(), resourceSchema),
  volumes: z.record(z.string(), resourceSchema),
});
const declared = z.object({
  services: z.record(z.string(), z.unknown()),
  networks: z.record(z.string(), z.unknown()),
  volumes: z.record(z.string(), z.unknown()),
});

const override = fileSchema.parse(parse(overrideFor(COMPOSE, { names: NAMES, context: CONTEXT })));
const serviceOf = (name: string) => new Map(Object.entries(override.services)).get(name);
const real = declared.parse(parse(COMPOSE, { merge: true }));

test('every service, network and volume of docker-compose.yml is labelled with the CI job and the run, and nothing else is declared', () => {
  expect(Object.keys(override.services)).toEqual(Object.keys(real.services));
  expect(Object.keys(override.networks)).toEqual(Object.keys(real.networks));
  expect(Object.keys(override.volumes)).toEqual(Object.keys(real.volumes));
  const all = [override.services, override.networks, override.volumes].flatMap((group) => Object.values(group));
  expect(all.length).toBeGreaterThan(8);
  for (const resource of all) {
    expect(resource.labels).toEqual(LABELS);
  }
});

test("the services that build the image get the stack's own tag, the checkout as context and the labels on the image", () => {
  for (const name of ['migrate', 'app']) {
    expect(serviceOf(name)).toEqual({
      image: NAMES.image,
      labels: LABELS,
      build: { context: CONTEXT, labels: LABELS },
    });
  }
});

test('the services that pull an image keep it: no image, no build', () => {
  for (const name of ['postgres', 'caddy']) {
    expect(serviceOf(name)).toEqual({ labels: LABELS });
  }
});

test('a compose file with other names gets the same treatment, so a new service is covered without a change here', () => {
  const text =
    'services:\n  worker:\n    build: .\n  cache:\n    image: redis\nnetworks:\n  edge:\nvolumes:\n  data:\n';
  const other = fileSchema.parse(parse(overrideFor(text, { names: NAMES, context: CONTEXT })));
  expect(other.services['worker']?.image).toBe(NAMES.image);
  expect(other.services['cache']).toEqual({ labels: LABELS });
  expect([other.networks['edge']?.labels, other.volumes['data']?.labels]).toEqual([LABELS, LABELS]);
});

test('a file that is not a compose file is refused', () => {
  expect(() => overrideFor('services: 3\n', { names: NAMES, context: CONTEXT })).toThrow();
});
