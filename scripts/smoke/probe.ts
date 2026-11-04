// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import type { ExecResult } from '../ci/lib/exec.ts';
import type { Stack } from './stack-types.ts';

// E19-S08: how the smoke scenarios look into a running stack: what Docker reports about a container, a command run inside it,
// and a statement run in the database as one of the two roles. Everything goes through `docker compose` and `docker`, and
// nothing prints a password: the statement's role password is read from its secret file inside the container.

/** The part of `docker inspect` the scenarios read. */
const containerSchema = z.object({
  Id: z.string(),
  RestartCount: z.number(),
  Config: z.object({
    User: z.string(),
    Env: z.array(z.string()),
    Labels: z.record(z.string(), z.string()),
  }),
  State: z.object({
    Status: z.string(),
    ExitCode: z.number(),
    StartedAt: z.string(),
    FinishedAt: z.string(),
    Health: z.object({ Status: z.string() }).optional(),
  }),
  HostConfig: z.object({
    ReadonlyRootfs: z.boolean(),
    CapDrop: z.array(z.string()).nullable(),
    SecurityOpt: z.array(z.string()).nullable(),
    PortBindings: z.record(z.string(), z.unknown()).nullable(),
  }),
  NetworkSettings: z.object({
    Ports: z.record(z.string(), z.array(z.object({ HostIp: z.string(), HostPort: z.string() })).nullable()),
  }),
});

export type Container = z.output<typeof containerSchema>;

type Compose = Pick<Stack, 'compose' | 'docker'>;

/** What a command printed, or why it failed: the output of a failed call is part of the message of the test that expected success. */
export function output(result: ExecResult): string {
  return `${result.stdout}${result.stderr}`.trim();
}

/** The container `id` (an id or a name), as Docker reports it; `what` names it in the error of a failed call. */
export async function inspectContainer(stack: Pick<Stack, 'docker'>, id: string, what = id): Promise<Container> {
  const inspected = await stack.docker(['inspect', '--format', '{{json .}}', id]);
  if (inspected.code !== 0) {
    throw new Error(`docker inspect ${what} failed: ${output(inspected)}`);
  }
  return containerSchema.parse(JSON.parse(inspected.stdout));
}

/** The container of `service`, as Docker reports it; a service without a container fails the scenario that asked. */
export async function inspectService(stack: Compose, service: string): Promise<Container> {
  const listed = await stack.compose(['ps', '--all', '--quiet', service]);
  const [id] = listed.stdout.trim().split('\n');
  if (listed.code !== 0 || id === undefined || id === '') {
    throw new Error(`service ${service} has no container: ${output(listed)}`);
  }
  return inspectContainer(stack, id, service);
}

/** How long the container lived, from the start Docker recorded to the exit it recorded: the application's own time, without Docker's. */
export function lifetimeMs(container: Container): number {
  return Date.parse(container.State.FinishedAt) - Date.parse(container.State.StartedAt);
}

/** Runs `command` in the running container of `service` (no terminal, so it works in CI). */
export function execIn(stack: Compose, service: string, command: readonly string[]): Promise<ExecResult> {
  return stack.compose(['exec', '-T', service, ...command]);
}

/** The two roles of the database (scripts/provision-database.sh). */
export type Role = 'cla_app' | 'cla_owner';

/** The file of the postgres container that holds the password of `role`. */
function passwordFile(role: Role): string {
  return role === 'cla_app' ? '/run/secrets/db_app_password' : '/run/secrets/db_owner_password';
}

/**
 * Runs one SQL statement in the `cla` database as `role`, over TCP with the role's password (read from its secret file inside
 * the container, so it is on no command line). Errors are printed with their SQLSTATE and message, so `42501` (insufficient
 * privilege) can be told from any other failure; the result has the output of `psql` and its exit code.
 */
export function sqlAs(stack: Compose, role: Role, statement: string): Promise<ExecResult> {
  const script =
    'PGPASSWORD=$(cat "$1") exec psql --host 127.0.0.1 --username "$2" --dbname cla --no-psqlrc --tuples-only --no-align ' +
    '--set ON_ERROR_STOP=1 --set VERBOSITY=verbose --command "$3"';
  return execIn(stack, 'postgres', ['sh', '-c', script, 'sh', passwordFile(role), role, statement]);
}
