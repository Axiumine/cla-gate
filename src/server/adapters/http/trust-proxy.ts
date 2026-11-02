// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { TrustProxy } from '../../config/trust-proxy.ts';

/**
 * Fastify accepts a hop count at runtime but its types do not list one, so a count becomes the equivalent function.
 * @returns the setting in a form Fastify's types accept: a boolean, a list of addresses or a trust function.
 */
export function fastifyTrustProxy(
  setting: TrustProxy,
): boolean | string[] | ((address: string, hop: number) => boolean) {
  if (typeof setting === 'number') {
    return (_address, hop) => hop < setting;
  }
  return typeof setting === 'boolean' ? setting : [...setting];
}
