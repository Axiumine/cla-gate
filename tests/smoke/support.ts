// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { inject } from 'vitest';
import { connect } from '../../scripts/smoke/stack.ts';
import { stackDeps } from '../../scripts/smoke/system.ts';

// E19-S08: what the test files of the smoke run share: the setup-mode stack that tests/smoke/global-setup.ts started, and a
// way to ask its application a question over HTTP on the random loopback port.

const REQUEST_TIMEOUT_MS = 10_000;

/** The stack of the run, as the global setup left it. */
export const stack = connect(stackDeps, inject('stack'));

/** A `GET` to the application of the stack, redirects not followed (a redirect is an answer the test may want to see). */
export function get(pathname: string, headers: Readonly<Record<string, string>> = {}): Promise<Response> {
  return fetch(`${stack.url}${pathname}`, {
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}
