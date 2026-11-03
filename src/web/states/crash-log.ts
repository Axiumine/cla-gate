// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { visibleRequestId } from './error-facts.ts';

// What the error boundaries write down (E17-S07): the name of the error and the request id, to the console of the browser and
// nowhere else. Not the message (it can hold what the server sent), not the stack, not the payload; nothing is sent over
// the network, so a crash report is a thing the person can read out to support and the operator never receives by itself.

const SAFE_NAME = /^[A-Za-z][A-Za-z0-9_.]{0,63}$/;

/** The name of a thrown value when it is a short identifier, else the generic `Error`: a thrown object could carry anything in its name. */
function nameOf(error: unknown): string {
  return error instanceof Error && SAFE_NAME.test(error.name) ? error.name : 'Error';
}

/** Logs `Unhandled <name>`, and the request id when the error has one. */
export function logCrash(error: unknown): void {
  const requestId = visibleRequestId(error);
  const name = nameOf(error);
  console.error(requestId === undefined ? `Unhandled ${name}` : `Unhandled ${name}, request ${requestId}`);
}
