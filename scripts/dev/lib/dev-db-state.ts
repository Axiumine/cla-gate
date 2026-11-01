// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { PORT_MAX, PORT_MIN } from '../../ci/lib/ports.ts';

// The port `yarn db:up` chose, remembered in the git-ignored .local/ directory so that db:url, dev and db:migrate find
// the database again. It is only a cache: a missing or unusable file means "no database recorded".

const STATE_FILE = '.local/db.json';
const stateSchema = z.object({ port: z.number().int().min(PORT_MIN).max(PORT_MAX) });

function statePath(root: string): string {
  return path.join(root, STATE_FILE);
}

/** The remembered port, or undefined when there is none or the file is unusable (it is only a cache). */
export function readPort(root: string): number | undefined {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- developer CLI: the state file inside the repository root
    const raw: unknown = JSON.parse(fs.readFileSync(statePath(root), 'utf8'));
    const parsed = stateSchema.safeParse(raw);
    return parsed.success ? parsed.data.port : undefined;
  } catch {
    return undefined;
  }
}

export function writePort(root: string, port: number): void {
  const file = statePath(root);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- developer CLI: the state directory inside the repository root
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- developer CLI: the state file inside the repository root
  fs.writeFileSync(file, `${JSON.stringify({ port })}\n`, 'utf8');
}

export function forgetPort(root: string): void {
  fs.rmSync(statePath(root), { force: true });
}
