// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { convertRequestSchema } from '../../shared/setup.ts';

// What GitHub puts in the address of `/setup/callback` (E19-S07).

/** The `code` and `state` of the address, checked against the request the conversion takes. */
export interface CallbackParams {
  readonly code: string;
  readonly state: string;
}

/**
 * The `code` and `state` in a query string, or `undefined` when either is missing, appears more than once, or does not look
 * like the value GitHub and the server make. The raw query is read, not the router's: the router parses a value that looks
 * like a JSON number into a number, and a one-time code of digits only would not survive it.
 */
export function readCallbackParams(search: string): CallbackParams | undefined {
  const query = new URLSearchParams(search);
  const codes = query.getAll('code');
  const states = query.getAll('state');
  if (codes.length !== 1 || states.length !== 1) {
    return undefined;
  }
  const parsed = convertRequestSchema.safeParse({ code: codes[0], state: states[0] });
  return parsed.success ? parsed.data : undefined;
}
