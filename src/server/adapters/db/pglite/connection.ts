// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { PGlite } from '@electric-sql/pglite';
import type { CompiledQuery, DatabaseConnection, QueryResult } from 'kysely';
import { toExecResult, toQueryResult } from './results.ts';

export class PgliteConnection implements DatabaseConnection {
  readonly #client: PGlite;
  readonly release: () => void;

  constructor(client: PGlite, release: () => void) {
    this.#client = client;
    this.release = release;
  }

  async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    if (query.parameters.length === 0) {
      return toExecResult(await this.#client.exec(query.sql));
    }
    const result = await this.#client.query<R>(query.sql, [...query.parameters]);
    return toQueryResult(result.rows, result.affectedRows);
  }

  /** Kysely's streaming API is not used here: fail loudly instead of buffering silently. */
  streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('PGlite connections do not support streaming');
  }
}
