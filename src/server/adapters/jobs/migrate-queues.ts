// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { ConstructorOptions } from 'pg-boss';
import type { Database } from '../db/schema.ts';
import { type Boss, createPgBoss, ownerBossOptions } from './boss.ts';
import { DEFAULT_INDEX_BUILD_WAIT, type IndexBuildWait, waitForIndexBuilds } from './index-builds.ts';
import { policyMismatches, QueuePolicyError } from './queue-policy.ts';
import { EXPIRE_IN_SECONDS, QUEUE_DEFINITIONS, QUEUES, type QueueName } from './queues.ts';
import { grantRuntimeAccess } from './runtime-grants.ts';

// The second step of `yarn db:migrate` (E07-S01), after the SQL files: pg-boss's own schema, the queues and the grants
// of the runtime role. pg-boss creates and migrates its own schema (`pgboss`, in the database of the application) when
// it starts with the owner's rights; the migrations of this repository never touch it. The runtime role starts pg-boss
// with schema creation and migration off, so only this step ever changes the schema, and a pg-boss upgrade is a
// deployment of the new build followed by `yarn db:migrate`.

export interface QueueMigrationOptions {
  /** The owner's connection string; it contains the password. */
  readonly connectionString: string;
  /** A connection of the same owner, for the grants. */
  readonly db: Kysely<Database>;
  /** Called for the errors pg-boss reports on its own connections. */
  readonly onError: (error: Error) => void;
  /** Defaults to pg-boss. Tests pass a fake. */
  readonly createBoss?: (options: ConstructorOptions) => Boss;
  readonly indexBuildWait?: IndexBuildWait;
}

export interface QueueMigration {
  /** The queues this run created, in the order of `QUEUES`; empty when they all existed. */
  readonly created: readonly QueueName[];
  /** `skipped` when the role `cla_app` does not exist. */
  readonly grants: 'granted' | 'skipped';
}

/**
 * Creates the queues that do not exist yet, each with its policy (E07-S02). Idempotent: an existing queue is left as it
 * is. A queue that exists with another policy than the table gives it is an error, because a policy cannot be changed.
 */
async function createMissingQueues(boss: Boss): Promise<QueueName[]> {
  const found = await boss.getQueues([...QUEUES]);
  const mismatches = policyMismatches(found);
  if (mismatches.length > 0) {
    throw new QueuePolicyError(mismatches);
  }
  const existing = new Set(found.map((queue) => queue.name));
  const created: QueueName[] = [];
  for (const { name, policy } of QUEUE_DEFINITIONS) {
    if (!existing.has(name)) {
      await boss.createQueue(name, { policy, expireInSeconds: EXPIRE_IN_SECONDS });
      created.push(name);
    }
  }
  return created;
}

/**
 * Installs or migrates the pgboss schema, creates the missing queues, waits for the index builds a migration queued,
 * and grants the runtime role. Safe to run again and from two places at once (pg-boss takes its own locks).
 */
export async function migrateJobQueues(options: QueueMigrationOptions): Promise<QueueMigration> {
  const boss = (options.createBoss ?? createPgBoss)(ownerBossOptions(options.connectionString));
  boss.on('error', options.onError);
  let created: QueueName[];
  try {
    await boss.start();
    created = await createMissingQueues(boss);
    await waitForIndexBuilds(boss, options.indexBuildWait ?? DEFAULT_INDEX_BUILD_WAIT);
  } finally {
    await boss.stop();
  }
  return { created, grants: await grantRuntimeAccess(options.db) };
}
