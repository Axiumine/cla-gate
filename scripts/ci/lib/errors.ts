// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { printable } from '../../code-caps/types.ts';

/** A thrown value as one printable string: an Error's message, anything else stringified; control characters escaped except the newlines the caller splits on. */
export function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text
    .split('\n')
    .map((line) => printable(line))
    .join('\n');
}

/**
 * `<tool> <command>: <first line>`, then one `| `-prefixed line per further line of the message. Continuation lines
 * (container logs) lose their control characters and cannot start with `::`, so nothing a container prints can pass for
 * a workflow command.
 */
export function reportLines(tool: string, command: string, error: unknown): string[] {
  const [first = '', ...rest] = messageOf(error).split('\n');
  return [`${tool} ${command}: ${first}`, ...rest.map((line) => `| ${line}`)];
}
