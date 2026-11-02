// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely, Selectable, Transaction } from 'kysely';
import { expectTypeOf, test } from 'vitest';
import type { AUDIT_ACTIONS } from '../../shared/audit.ts';
import type { GithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import { type AuditEntry, appendAudit } from './audit.ts';

// These tests are checked by `tsc` (yarn typecheck): a regression makes the project fail to compile.

test('appendAudit takes a Transaction, so the plain database handle does not compile', () => {
  expectTypeOf(appendAudit).parameter(0).toEqualTypeOf<Transaction<Database>>();
  expectTypeOf<Transaction<Database>>().toExtend<Kysely<Database>>();
  expectTypeOf<Kysely<Database>>().not.toExtend<Parameters<typeof appendAudit>[0]>();
});

test('the actor is a GithubId: the users.id surrogate key and a plain number do not compile', () => {
  expectTypeOf<AuditEntry['actorGithubId']>().toEqualTypeOf<GithubId | null>();
  expectTypeOf<Selectable<Database['users']>['id']>().not.toExtend<GithubId>();
  expectTypeOf<number>().not.toExtend<NonNullable<AuditEntry['actorGithubId']>>();
});

test('the action is a member of the closed tuple, not any string', () => {
  expectTypeOf<AuditEntry['action']>().toEqualTypeOf<(typeof AUDIT_ACTIONS)[number]>();
  expectTypeOf<string>().not.toExtend<AuditEntry['action']>();
});

test('the entry needs its installation and actor keys, and metadata keys are closed', () => {
  expectTypeOf<AuditEntry>().toHaveProperty('installationId').toEqualTypeOf<number | null>();
  expectTypeOf<{ action: 'repository.enabled' }>().not.toExtend<AuditEntry>();
  // @ts-expect-error -- the point of the test: a personal-data key is not a member of the closed metadata keys
  const refused: AuditEntry['metadata'] = { email: 'alice@example.com' };
  expectTypeOf(refused).toEqualTypeOf<AuditEntry['metadata']>();
});
