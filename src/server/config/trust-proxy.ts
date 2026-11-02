// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { isIP } from 'node:net';

/** Fastify's `trustProxy` setting: all hops, no proxy, a number of hops, or a list of trusted addresses/CIDRs. */
export type TrustProxy = boolean | number | readonly string[];

const HOPS = /^\d{1,3}$/;
const PREFIX = /^\d{1,3}$/;

function isAddressOrCidr(entry: string): boolean {
  // Stryker disable next-line StringLiteral: split() always returns at least one element, so the default is never used (the compiler wants it)
  const [address = '', prefix, ...rest] = entry.split('/');
  const family = isIP(address);
  if (rest.length > 0 || (family !== 4 && family !== 6)) {
    return false;
  }
  // A /0 prefix would trust every address, and the proxy-addr library behind Fastify refuses it: reject it here, by name.
  return (
    prefix === undefined || (PREFIX.test(prefix) && Number(prefix) >= 1 && Number(prefix) <= (family === 4 ? 32 : 128))
  );
}

/**
 * `true`, `false`, a hop count (`1`) or a comma separated list of IP addresses and CIDRs
 * (`10.0.0.0/8,127.0.0.1`). Returns `undefined` for anything else, so a typo never silently trusts every proxy.
 * @returns the parsed setting, or `undefined` when the text is none of the accepted forms.
 */
export function parseTrustProxy(raw: string): TrustProxy | undefined {
  const value = raw.trim().toLowerCase();
  if (value === 'true' || value === 'false') {
    return value === 'true';
  }
  if (HOPS.test(value)) {
    return Number(value);
  }
  const entries = raw.split(',').map((entry) => entry.trim());
  return entries.every(isAddressOrCidr) ? entries : undefined;
}
