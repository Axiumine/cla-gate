// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import type { Exec } from '../../ci/lib/exec.ts';
import { LOOPBACK, withFreePort } from '../../ci/lib/ports.ts';
import { forgetPort, readPort, writePort } from './dev-db-state.ts';

// The development database (docker-compose.dev.yml, E19-S04): a PostgreSQL 18 container whose host port is chosen at random,
// remembered in the git-ignored .local/ directory, and published on 127.0.0.1 only. The passwords are the well-known
// development defaults that docker-compose.dev.yml hands to scripts/provision-database.sh (compose.test.ts keeps them in step).

export type Role = 'app' | 'owner';

export const DATABASE_NAME = 'cla';

/** The development stack; docker-compose.yml is the operator stack and has no host port to choose. */
const COMPOSE_FILE = 'docker-compose.dev.yml';

/** The environment variable each role's URL is for: the runtime role is DATABASE_URL, the owner runs the migrations. */
export function roleVariable(role: Role): string {
  switch (role) {
    case 'app':
      return 'DATABASE_URL';
    case 'owner':
      return 'MIGRATION_DATABASE_URL';
  }
}

function credentials(role: Role): string {
  switch (role) {
    case 'app':
      return 'cla_app:cla_app_dev_only';
    case 'owner':
      return 'cla_owner:cla_owner_dev_only';
  }
}

const PORT_ATTEMPTS = 5;

export class DevDbError extends Error {
  override readonly name = 'DevDbError';
}

export interface DevDeps {
  readonly exec: Exec;
  readonly pickPort: () => Promise<number>;
}

/** Compose ends its error output with the actual reason. */
function lastLine(text: string): string {
  return text.trim().split('\n').slice(-1).join('');
}

/** The loopback connection URL of the development database on `port`: the runtime role's, or the owner's for migrations. */
export function connectionUrl(role: Role, port: number): string {
  return `postgres://${credentials(role)}@${LOOPBACK}:${port}/${DATABASE_NAME}`;
}

/** The URL of a running development database, or an error that says what to run. */
export function requireUrl(root: string, role: Role): string {
  const port = readPort(root);
  if (port === undefined) {
    throw new DevDbError(
      'no development database is recorded: run "yarn db:up" first, or set the URL variable yourself',
    );
  }
  return connectionUrl(role, port);
}

/** Compose reads POSTGRES_PORT for every subcommand (the file requires it), so each call passes it. */
function compose(deps: DevDeps, root: string, port: number, args: readonly string[]) {
  const base = ['compose', '--file', path.join(root, COMPOSE_FILE), '--project-directory', root];
  return deps.exec('docker', [...base, ...args], { POSTGRES_PORT: String(port) });
}

async function isRunning(deps: DevDeps, root: string, port: number): Promise<boolean> {
  const result = await compose(deps, root, port, ['ps', '--status', 'running', '--quiet', 'postgres']);
  return result.code === 0 && result.stdout.trim() !== '';
}

/** Starts (or finds) the database and returns its port. A running database keeps the port it was started with. */
export async function databaseUp(deps: DevDeps, root: string): Promise<number> {
  const remembered = readPort(root);
  if (remembered !== undefined && (await isRunning(deps, root, remembered))) {
    return remembered;
  }
  const { port, result } = await withFreePort({
    pickPort: deps.pickPort,
    attempts: PORT_ATTEMPTS,
    run: (candidate) => {
      writePort(root, candidate);
      return compose(deps, root, candidate, ['up', '--detach', '--wait', 'postgres']);
    },
    reset: () => Promise.resolve(),
  }).catch((error: unknown) => {
    forgetPort(root);
    throw error;
  });
  if (result.code !== 0) {
    forgetPort(root);
    throw new DevDbError(`docker compose up failed: ${lastLine(result.stderr)}`);
  }
  return port;
}

/** Stops and removes the container; the data volume stays unless `volumes` is set. Forgets the remembered port. */
export async function databaseDown(deps: DevDeps, root: string, volumes: boolean): Promise<void> {
  // Compose still interpolates the port when it only tears down; any valid number will do, so 1 stands for "none".
  const result = await compose(deps, root, readPort(root) ?? 1, volumes ? ['down', '--volumes'] : ['down']);
  if (result.code !== 0) {
    throw new DevDbError(`docker compose down failed: ${lastLine(result.stderr)}`);
  }
  forgetPort(root);
}
