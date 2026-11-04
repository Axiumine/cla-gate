// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import { runLabels, type StackNames } from './names.ts';

// E19-S08: the compose override of a smoke stack. The stack runs the real docker-compose.yml; this file only adds what a
// shared daemon needs: the two labels on every container, network and volume, an image tag of its own, the build context
// of the checkout (the stack's directory holds the compose file and the secrets, not the sources), and a subnet of its own for
// each network the compose file leaves to Docker.

/**
 * The networks that docker-compose.yml declares without a subnet, and the dotenv setting that holds the /24 the override gives
 * each. Left to Docker, such a network takes the first free /16 of its pool at the moment it is created, and that /16 can hold
 * the random /24 of the stack's `default` network, which does not exist yet when a scenario removes the stack and starts only the
 * database: the next `docker compose up` then fails with "Pool overlaps with other one on this address space". A subnet of its
 * own, drawn with the other one (bring-up.ts), leaves nothing to the order in which the networks are created.
 */
export const NETWORK_SUBNETS: Readonly<Record<string, string>> = { backend: 'SMOKE_BACKEND_SUBNET' };

/** What the override needs to know about the real file: the names it declares, and which services build the image. */
const composeSchema = z.object({
  services: z.record(z.string(), z.object({ build: z.unknown().optional() })),
  networks: z.record(z.string(), z.object({ ipam: z.unknown().optional() }).nullable()),
  volumes: z.record(z.string(), z.unknown()),
});

export interface OverrideOptions {
  readonly names: StackNames;
  /** Absolute path of the checkout: the build context. */
  readonly context: string;
  /** Keys a scenario adds to a service (E19-S12), such as `extra_hosts`; they come after the labels, so they win. A service the file lacks is refused. */
  readonly services?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/** The `ipam` of a network that has no subnet of its own in the compose file and one in {@link NETWORK_SUBNETS}; nothing otherwise. */
function subnetOf(name: string, ipam: unknown) {
  const setting = new Map(Object.entries(NETWORK_SUBNETS)).get(name);
  return setting === undefined || ipam !== undefined ? {} : { ipam: { config: [{ subnet: `\${${setting}}` }] } };
}

/**
 * The override for the compose file `composeText`, as YAML. Every service, network and volume the file declares is labelled,
 * so a resource added to the stack later is covered without a change here. The services that build the image get the stack's
 * own tag and the labels on the image too, which is what the clean-up finds it by.
 */
export function overrideFor(composeText: string, options: OverrideOptions): string {
  const compose = composeSchema.parse(parse(composeText, { merge: true }));
  const extra = new Map(Object.entries(options.services ?? {}));
  const unknown = [...extra.keys()].filter((name) => !Object.hasOwn(compose.services, name));
  if (unknown.length > 0) {
    throw new Error(`the compose file has no service ${unknown.join(', ')}`);
  }
  const labels = runLabels(options.names.run);
  const labelled = () => ({ labels });
  const service = (build: unknown) =>
    build === undefined
      ? labelled()
      : { image: options.names.image, build: { context: options.context, labels }, labels };
  return stringify({
    services: Object.fromEntries(
      Object.entries(compose.services).map(([name, body]) => [name, { ...service(body.build), ...extra.get(name) }]),
    ),
    networks: Object.fromEntries(
      Object.entries(compose.networks).map(([name, body]) => [name, { ...labelled(), ...subnetOf(name, body?.ipam) }]),
    ),
    volumes: Object.fromEntries(Object.keys(compose.volumes).map((name) => [name, labelled()])),
  });
}
