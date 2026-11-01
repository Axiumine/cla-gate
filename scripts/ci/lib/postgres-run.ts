// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { LOOPBACK } from './ports.ts';

/**
 * Tag and digest: the tag documents the major version, the digest pins the image. Bump both together, ideally with the
 * PGlite pin in package.json (PGlite 0.5.14 is PostgreSQL 18.6).
 */
export const POSTGRES_IMAGE = 'postgres:18@sha256:3a4264520e121176619f54ff867d12774bc81e95e7b84db58d63bccdb6144b81';

/**
 * Marks every container this helper creates, so a leftover can be found with `docker ps -a --filter label=...`, and so
 * that `stop` removes nothing else: the Docker daemon is shared with other repositories.
 */
export const LABEL_KEY = 'cla-gate.ci';
export const LABEL_VALUE = 'postgres';
export const CONTAINER_LABEL = `${LABEL_KEY}=${LABEL_VALUE}`;

/** Every container name this helper creates starts with this; `stop` refuses any other name. */
export const CONTAINER_PREFIX = 'cla-pg-';

/** What Docker accepts as a name, minus the characters that could pass for an option when handed to the CLI. */
export const NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/;

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
