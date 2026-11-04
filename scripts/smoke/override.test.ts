// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';
import { readText } from '../ci/lib/test-support.ts';
import { stackNames } from './names.ts';
import { NETWORK_SUBNETS, overrideFor } from './override.ts';
import { ROOT } from './test-support.ts';

// E19-S08: the compose override of a smoke stack labels everything the real docker-compose.yml declares, gives a subnet to each
// network the file leaves to Docker, and changes nothing else.

const COMPOSE = readText(path.join(ROOT, 'docker-compose.yml'));
const NAMES = stackNames('cla-smoke-77-1', 'boot');
const LABELS = { 'cla-gate.ci': 'container', 'cla-gate.run': 'cla-smoke-77-1' };
const CONTEXT = '/work/checkout';

const resourceSchema = z.object({
  labels: z.record(z.string(), z.string()),
  ipam: z
    .object({ config: z.array(z.object({ subnet: z.string() }).strict()) })
    .strict()
    .optional(),
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
  networks: z.record(z.string(), z.object({ ipam: z.unknown().optional() }).nullable()),
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

test('every network that docker-compose.yml leaves without a subnet gets one from the dotenv file, and the others keep theirs', () => {
  const networks = Object.entries(real.networks);
  const open = networks.filter(([, body]) => body?.ipam === undefined).map(([name]) => name);
  const pinned = Object.keys(NETWORK_SUBNETS);
  expect(open.length).toBeGreaterThan(0);
  expect(open.toSorted((a, b) => a.localeCompare(b))).toEqual(pinned.toSorted((a, b) => a.localeCompare(b)));
  const overridden = new Map(Object.entries(override.networks));
  for (const [name, setting] of Object.entries(NETWORK_SUBNETS)) {
    expect(overridden.get(name)?.ipam).toEqual({ config: [{ subnet: `\${${setting}}` }] });
  }
  const kept = networks.filter(([, body]) => body?.ipam !== undefined);
  expect(kept.length).toBeGreaterThan(0);
  for (const [name] of kept) {
    expect(overridden.get(name)?.ipam, name).toBeUndefined();
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
  expect(other.networks['edge']?.ipam).toBeUndefined();
});

test('a file that is not a compose file is refused', () => {
  expect(() => overrideFor('services: 3\n', { names: NAMES, context: CONTEXT })).toThrow();
});

test('keys a scenario adds to a service (E19-S12) come after its labels, and the other services are left as they were', () => {
  const services = { app: { extra_hosts: ['api.github.com:127.0.0.1'], labels: { 'cla-gate.ci': 'mine' } } };
  const added = fileSchema
    .extend({ services: z.record(z.string(), resourceSchema.extend({ extra_hosts: z.array(z.string()).optional() })) })
    .parse(parse(overrideFor(COMPOSE, { names: NAMES, context: CONTEXT, services })));
  expect(added.services['app']).toEqual({
    image: NAMES.image,
    build: { context: CONTEXT, labels: LABELS },
    labels: { 'cla-gate.ci': 'mine' },
    extra_hosts: ['api.github.com:127.0.0.1'],
  });
  expect(added.services['migrate']).toEqual(serviceOf('migrate'));
  expect(added.services['postgres']).toEqual({ labels: LABELS });
});

test('keys for a service the file does not declare are refused, naming each; an empty map changes nothing', () => {
  const services = { nope: { init: true }, nothing: { init: true } };
  expect(() => overrideFor(COMPOSE, { names: NAMES, context: CONTEXT, services })).toThrow(
    'the compose file has no service nope, nothing',
  );
  expect(() => overrideFor(COMPOSE, { names: NAMES, context: CONTEXT, services: { constructor: {} } })).toThrow(
    'no service constructor',
  );
  expect(overrideFor(COMPOSE, { names: NAMES, context: CONTEXT, services: {} })).toBe(
    overrideFor(COMPOSE, { names: NAMES, context: CONTEXT }),
  );
});
