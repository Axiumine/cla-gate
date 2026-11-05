// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, type KyselyPlugin, PostgresQueryCompiler, sql } from 'kysely';
import type { Database } from '../../adapters/db/schema.ts';
import { insertSessionRow } from '../../adapters/db/sessions-fixture/test-support.ts';
import { migratedRuntimeDatabase } from '../../adapters/db/test-support.ts';
import { FakeClock } from '../test-support.ts';
import type { RetentionDeps, RetentionSettings } from './retention-sweep.ts';

// What the tests of the retention sweep share (E22-S04): a migrated database with the runtime role, a clock that stands at a
// fixed instant, webhook deliveries and sessions written by hand in any state, a plugin that records every statement the sweep
// sends and one that makes the Nth batch fail.

/** The instant every test of the sweep stands at: 03:17 UTC, when the daily job runs. */
export const NOW_TEXT = '2026-11-05T03:17:00.000Z';
export const NOW = new Date(NOW_TEXT);
export const SECOND = 1000;
export const DAY = 86_400_000;
/** The instant `ms` milliseconds after `NOW` (negative: before). */
export const at = (milliseconds: number): Date => new Date(NOW.getTime() + milliseconds);

const DEFAULTS: RetentionSettings = { webhookDeliveriesDays: 30, batchSize: 5000 };

/** The cutoff of the webhook deliveries with the default 30 days, and the cutoff of the sessions: one day. */
export const DELIVERY_CUTOFF = at(-30 * DAY);
export const SESSION_CUTOFF = at(-DAY);

export interface RetentionWorld {
  readonly db: Kysely<Database>;
  readonly clock: FakeClock;
  /** `users.id` of the person every session belongs to. */
  readonly userId: number;
  /** The dependencies of a run over `db`, with the settings given to {@link retentionWorld}. */
  readonly deps: RetentionDeps;
}

/** A database where `cla_app` exists and holds its grants, one user, and the dependencies of the sweep over it. */
export async function retentionWorld(settings: Partial<RetentionSettings> = {}): Promise<RetentionWorld> {
  const { db } = await migratedRuntimeDatabase();
  const user = await db
    .insertInto('users')
    .values({ github_id: 7_700_001, login: 'login-7700001', name: 'Name 7700001', avatar_url: null })
    .returning('id')
    .executeTakeFirstOrThrow();
  const clock = new FakeClock(NOW_TEXT);
  return { db, clock, userId: user.id, deps: { db, clock, settings: { ...DEFAULTS, ...settings } } };
}

/** Writes a webhook delivery that was processed at `processedAt`, or is pending when it is null. */
export async function insertDelivery(db: Kysely<Database>, id: string, processedAt: Date | null): Promise<void> {
  await db
    .insertInto('webhook_deliveries')
    .values({ delivery_id: id, event: 'pull_request', action: 'opened', processed_at: processedAt })
    .execute();
}

/** The ids of the stored deliveries, in order. */
export async function deliveryIds(db: Kysely<Database>): Promise<string[]> {
  const rows = await db.selectFrom('webhook_deliveries').select('delivery_id').orderBy('delivery_id').execute();
  return rows.map((row) => row.delivery_id);
}

/** A session of the world's person that dies idle at `idle` and absolute at `absolute` (the table needs idle not after absolute). */
export function insertSession(world: RetentionWorld, seed: number, idle: Date, absolute: Date = idle): Promise<number> {
  return insertSessionRow(world.db, world.userId, seed, {
    createdAt: at(-60 * DAY),
    idleExpiresAt: idle,
    absoluteExpiresAt: absolute,
  });
}

/** The ids of the stored sessions, in order. */
export async function sessionIds(db: Kysely<Database>): Promise<number[]> {
  const rows = await db.selectFrom('sessions').select('id').orderBy('id').execute();
  return rows.map((row) => row.id);
}

/** The audit rows of the retention sweep. */
export async function sweptRows(db: Kysely<Database>) {
  return db
    .selectFrom('audit_log')
    .select(['action', 'installation_id', 'actor_github_id', 'subject_type', 'subject_id', 'metadata'])
    .where('action', '=', 'retention.swept')
    .orderBy('id')
    .execute();
}

/** `n` expired deliveries named `<prefix>-<index>`, all processed at `processedAt`. Returns their ids. */
export async function insertDeliveries(
  db: Kysely<Database>,
  prefix: string,
  n: number,
  processedAt: Date,
): Promise<string[]> {
  const ids = Array.from({ length: n }, (_unused, index) => `${prefix}-${String(index).padStart(3, '0')}`);
  for (const id of ids) {
    await insertDelivery(db, id, processedAt);
  }
  return ids;
}

/** The text of every statement a plugin saw, in order. */
export interface Recorder {
  readonly plugin: KyselyPlugin;
  readonly statements: string[];
}

/** A plugin that records the SQL of every statement sent through the handle it is added to, and changes nothing. */
export function recordStatements(): Recorder {
  const compiler = new PostgresQueryCompiler();
  const statements: string[] = [];
  const plugin: KyselyPlugin = {
    transformQuery: (args) => {
      statements.push(compiler.compileQuery(args.node, args.queryId).sql);
      return args.node;
    },
    transformResult: (args) => Promise.resolve(args.result),
  };
  return { plugin, statements };
}

/** True for the statement of a batch: the data-modifying CTE of `deleteBatch`. */
const isBatch = (statement: string): boolean => statement.trimStart().startsWith('with gone as');

/**
 * A plugin that throws `error` when the `nth` batch (counting from 1) is about to be sent, and lets every other statement
 * through. Added to a handle with `db.withPlugin(...)`.
 */
export function failOnBatch(nth: number, error: Error): KyselyPlugin {
  const compiler = new PostgresQueryCompiler();
  let batches = 0;
  return {
    transformQuery: (args) => {
      if (isBatch(compiler.compileQuery(args.node, args.queryId).sql)) {
        batches += 1;
        if (batches === nth) {
          throw error;
        }
      }
      return args.node;
    },
    transformResult: (args) => Promise.resolve(args.result),
  };
}

/** A plugin that throws `error` when the audit row of a run is about to be inserted, and lets every other statement through. */
export function failOnAudit(error: Error): KyselyPlugin {
  const compiler = new PostgresQueryCompiler();
  return {
    transformQuery: (args) => {
      if (compiler.compileQuery(args.node, args.queryId).sql.startsWith('insert into "audit_log"')) {
        throw error;
      }
      return args.node;
    },
    transformResult: (args) => Promise.resolve(args.result),
  };
}

/** Runs `work` on one connection that has switched to `cla_app` for the whole of it, transactions included. */
export function onRuntimeConnection<T>(db: Kysely<Database>, work: (connection: Kysely<Database>) => Promise<T>) {
  return db.connection().execute(async (connection) => {
    await sql`set role cla_app`.execute(connection);
    try {
      return await work(connection);
    } finally {
      await sql`reset role`.execute(connection);
    }
  });
}
