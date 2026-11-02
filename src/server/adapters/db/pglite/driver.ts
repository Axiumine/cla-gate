// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { PGlite } from '@electric-sql/pglite';
import { CompiledQuery, type Driver, type TransactionSettings } from 'kysely';
import { PgliteConnection } from './connection.ts';
import { Mutex } from './mutex.ts';

export class PgliteDriver implements Driver {
  readonly #client: PGlite;
  readonly #mutex = new Mutex();

  constructor(client: PGlite) {
    this.#client = client;
  }

  // Stryker disable next-line BlockStatement: PGlite waits for its own start-up before every query, so this wait is only early
  async init(): Promise<void> {
    await this.#client.waitReady;
  }

  async acquireConnection(): Promise<PgliteConnection> {
    return new PgliteConnection(this.#client, await this.#mutex.acquire());
  }

  async beginTransaction(connection: PgliteConnection, settings: TransactionSettings): Promise<void> {
    const mode = [
      settings.isolationLevel ? `isolation level ${settings.isolationLevel}` : '',
      settings.accessMode ?? '',
    ].join(' ');
    // Stryker disable next-line MethodExpression: Postgres ignores whitespace around a statement, the trim is cosmetic
    await connection.executeQuery(CompiledQuery.raw(`start transaction ${mode}`.trimEnd()));
  }

  async commitTransaction(connection: PgliteConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('commit'));
  }

  async rollbackTransaction(connection: PgliteConnection): Promise<void> {
    await connection.executeQuery(CompiledQuery.raw('rollback'));
  }

  releaseConnection(connection: PgliteConnection): Promise<void> {
    connection.release();
    return Promise.resolve();
  }

  async destroy(): Promise<void> {
    await this.#client.close();
  }
}
