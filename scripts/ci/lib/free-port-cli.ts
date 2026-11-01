// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { messageOf } from './errors.ts';
import type { Io } from './io.ts';
import { pickSystemFreePort } from './ports.ts';

/** Prints exactly one port and nothing else on stdout, so `$(yarn ci:port)` works. Exit code 0, or 1 when none was found. */
export async function runFreePortCli(io: Io, pick: () => Promise<number> = pickSystemFreePort): Promise<number> {
  try {
    io.out(String(await pick()));
    return 0;
  } catch (error) {
    io.err(`free-port: ${messageOf(error)}`);
    return 1;
  }
}
