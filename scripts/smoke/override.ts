// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import { runLabels, type StackNames } from './names.ts';

// E19-S08: the compose override of a smoke stack. The stack runs the real docker-compose.yml; this file only adds what a
// shared daemon needs: the two labels on every container, network and volume, an image tag of its own, and the build context
// of the checkout (the stack's directory holds the compose file and the secrets, not the sources).

/** What the override needs to know about the real file: the names it declares, and which services build the image. */
const composeSchema = z.object({
  services: z.record(z.string(), z.object({ build: z.unknown().optional() })),
  networks: z.record(z.string(), z.unknown()),
  volumes: z.record(z.string(), z.unknown()),
});

export interface OverrideOptions {
  readonly names: StackNames;
  /** Absolute path of the checkout: the build context. */
  readonly context: string;
  /** Keys a scenario adds to a service (E19-S12), such as `extra_hosts`; they come after the labels, so they win. A service the file lacks is refused. */
  readonly services?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
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
    networks: Object.fromEntries(Object.keys(compose.networks).map((name) => [name, labelled()])),
    volumes: Object.fromEntries(Object.keys(compose.volumes).map((name) => [name, labelled()])),
  });
}
