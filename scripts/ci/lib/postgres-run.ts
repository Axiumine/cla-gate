// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { labelOf, type Owner } from './container-owner.ts';
import { LOOPBACK } from './ports.ts';

/**
 * Tag and digest: the tag documents the major version, the digest pins the image. Bump both together, ideally with the
 * PGlite pin in package.json (PGlite 0.5.14 is PostgreSQL 18.6).
 */
export const POSTGRES_IMAGE = 'postgres:18@sha256:3a4264520e121176619f54ff867d12774bc81e95e7b84db58d63bccdb6144b81';

/**
 * Every container name this helper creates starts with `cla-pg-` and carries the label `cla-gate.ci=postgres`, so a
 * leftover can be found with `docker ps -a --filter label=...`, and so that `stop` removes nothing else: the Docker
 * daemon is shared with other repositories.
 */
export const POSTGRES_OWNER: Owner = { prefix: 'cla-pg-', labelKey: 'cla-gate.ci', labelValue: 'postgres' };
export const CONTAINER_LABEL = labelOf(POSTGRES_OWNER);

/** The password reaches docker through its environment (`-e POSTGRES_PASSWORD` without a value), never through argv. */
export function runArguments(name: string, port: number, image: string): string[] {
  // The container side of the mapping is Postgres' own port inside the container; the host side is the random one.
  return [
    'run',
    '--detach',
    '--name',
    name,
    '--label',
    CONTAINER_LABEL,
    '--publish',
    `${LOOPBACK}:${port}:5432`,
    '--env',
    'POSTGRES_USER=postgres',
    '--env',
    'POSTGRES_PASSWORD',
    // TCP on purpose: during initialisation the image runs a temporary server that listens on its socket only, and a
    // socket check would report healthy too early.
    '--health-cmd',
    `pg_isready -h ${LOOPBACK} -U postgres`,
    '--health-interval',
    '2s',
    '--health-timeout',
    '3s',
    '--health-retries',
    '30',
    image,
  ];
}

export function databaseUrl(password: string, port: number): string {
  return `postgres://postgres:${password}@${LOOPBACK}:${port}/postgres`;
}
