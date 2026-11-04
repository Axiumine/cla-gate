// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { ConstructorOptions } from 'pg-boss';
import type { Database } from '../db/schema.ts';
import { type Boss, createPgBoss, ownerBossOptions } from './boss.ts';
import { DEFAULT_INDEX_BUILD_WAIT, type IndexBuildWait, waitForIndexBuilds } from './index-builds.ts';
import { boundsDrifted, updateFor } from './queue-options.ts';
import { policyMismatches, QueuePolicyError } from './queue-policy.ts';
import {
  DEFINITIONS_IN_CREATION_ORDER,
  QUEUES,
  type QueueName,
  queueSettings,
  SCHEDULER_QUEUE,
  schedulerQueueSettings,
} from './queues.ts';
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
  /**
   * The queues this run created, dead-letter queue first and pg-boss's queue of scheduled occurrences (E07-S08) last; empty
   * when they all existed.
   */
  readonly created: readonly (QueueName | typeof SCHEDULER_QUEUE)[];
  /** The queues that existed with other bounds or another dead-letter queue than the definitions give (E07-S05) and were brought in line. */
  readonly updated: readonly QueueName[];
  /** `skipped` when the role `cla_app` does not exist. */
  readonly grants: 'granted' | 'skipped';
}

/**
 * Creates the queues that do not exist yet, each with its policy (E07-S02), its retry, expiry and retention bounds and its
 * dead-letter queue (E07-S05), the dead-letter queue first, and then the queue pg-boss's scheduler files its occurrences in
 * (E07-S08), which the runtime role would otherwise have to create. Idempotent: an existing queue keeps its policy, and its
 * bounds are brought in line when an older build created it with others. A queue that exists with another policy than the
 * table gives it is an error, because a policy cannot be changed.
 */
async function createMissingQueues(
  boss: Boss,
): Promise<{ created: QueueMigration['created'][number][]; updated: QueueName[] }> {
  const found = await boss.getQueues([...QUEUES, SCHEDULER_QUEUE]);
  const mismatches = policyMismatches(found);
  if (mismatches.length > 0) {
    throw new QueuePolicyError(mismatches);
  }
  const created: QueueMigration['created'][number][] = [];
  const updated: QueueName[] = [];
  for (const definition of DEFINITIONS_IN_CREATION_ORDER) {
    const settings = queueSettings(definition);
    const existing = found.find((queue) => queue.name === definition.name);
    if (existing === undefined) {
      await boss.createQueue(definition.name, settings);
      created.push(definition.name);
    } else if (boundsDrifted(existing, settings)) {
      await boss.updateQueue(definition.name, updateFor(settings));
      updated.push(definition.name);
    }
  }
  if (!found.some((queue) => queue.name === SCHEDULER_QUEUE)) {
    await boss.createQueue(SCHEDULER_QUEUE, schedulerQueueSettings());
    created.push(SCHEDULER_QUEUE);
  }
  return { created, updated };
}

/**
 * Installs or migrates the pgboss schema, creates the missing queues, waits for the index builds a migration queued,
 * and grants the runtime role. Safe to run again and from two places at once: pg-boss takes its own locks while it installs
 * and migrates its schema, and the grants take theirs (E19-S12).
 */
export async function migrateJobQueues(options: QueueMigrationOptions): Promise<QueueMigration> {
  const boss = (options.createBoss ?? createPgBoss)(ownerBossOptions(options.connectionString));
  boss.on('error', options.onError);
  let changes: Awaited<ReturnType<typeof createMissingQueues>>;
  try {
    await boss.start();
    changes = await createMissingQueues(boss);
    await waitForIndexBuilds(boss, options.indexBuildWait ?? DEFAULT_INDEX_BUILD_WAIT);
  } finally {
    await boss.stop();
  }
  return { ...changes, grants: await grantRuntimeAccess(options.db) };
}
