// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import { onTestFinished, vi } from 'vitest';
import type { Database } from '../schema.ts';

// What the tests of the operator commands share (E22-S04, E22-S05): a database handle the command may close without closing the
// test's own, and a database that fails every statement the way PostgreSQL does.

/**
 * `db` as a command is given it: every call goes to the shared test database, except `destroy`, which the command makes at the
 * end of a run and which must not close the database the test goes on reading. `destroy` is the spy that sees it.
 */
export function closable(db: Kysely<Database>) {
  const destroy = vi.spyOn(db, 'destroy').mockImplementation(() => Promise.resolve());
  onTestFinished(() => {
    destroy.mockRestore();
  });
  return { handle: db, destroy };
}

/** A database that fails every statement, once it has run, with a PostgreSQL error that quotes a row. */
export function brokenDatabase(world: Kysely<Database>) {
  const failure = Object.assign(new Error('duplicate key value (zzzz-row) violates the constraint'), {
    name: 'error',
    code: '23505',
    detail: 'Key (delivery_id)=(zzzz-row) already exists.',
  });
  return world.withPlugin({
    transformQuery: (args) => args.node,
    transformResult: () => {
      throw failure;
    },
  });
}
