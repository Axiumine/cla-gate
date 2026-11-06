// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { Database } from '../../../src/server/adapters/db/schema.ts';
import { DOCUMENTS, FOREIGN_TENANT, REPOSITORIES, TENANT, VERSIONS } from './ids.ts';
import { at, insertRow } from './insert.ts';
import { ALICE, BOB, CAROL, type Person } from './people.ts';

// E18-S12: the audit log of the seeded tenants: six lines of the history that the other rows stand for, and one of the other tenant.

interface AuditSpec {
  readonly action: string;
  readonly actor: Person;
  readonly subject: readonly [string, number];
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
  readonly when: string;
}

const HISTORY: readonly AuditSpec[] = [
  {
    action: 'cla_document.created',
    actor: ALICE,
    subject: ['cla_document', DOCUMENTS.individual.id],
    metadata: { document_id: DOCUMENTS.individual.id, kind: 'individual' },
    when: '2026-01-05T09:30:00Z',
  },
  {
    action: 'cla_version.published',
    actor: ALICE,
    subject: ['cla_version', VERSIONS.v1],
    metadata: { document_id: DOCUMENTS.individual.id, version_id: VERSIONS.v1, major: 1, minor: 0 },
    when: '2026-01-12T10:00:00Z',
  },
  {
    action: 'repository.cla_document_attached',
    actor: ALICE,
    subject: ['repository', REPOSITORIES.widgets.id],
    metadata: { document_id: DOCUMENTS.individual.id, repository_id: REPOSITORIES.widgets.id },
    when: '2026-01-12T10:05:00Z',
  },
  {
    action: 'repository.enabled',
    actor: ALICE,
    subject: ['repository', REPOSITORIES.widgets.id],
    metadata: { repository_id: REPOSITORIES.widgets.id, enabled: true },
    when: '2026-01-12T10:06:00Z',
  },
  {
    action: 'signature.created',
    actor: CAROL,
    subject: ['signature', 9401],
    metadata: {
      document_id: DOCUMENTS.individual.id,
      version_id: VERSIONS.v2,
      major: 2,
      repository_id: REPOSITORIES.widgets.id,
    },
    when: '2026-03-12T10:00:00Z',
  },
  {
    action: 'signature.revoked',
    actor: ALICE,
    subject: ['signature', 9403],
    metadata: { signature_id: 9403, reason_code: 'signer_request' },
    when: '2026-04-02T11:00:00Z',
  },
];

export async function seedAudit(db: Kysely<Database>): Promise<void> {
  for (const [index, entry] of HISTORY.entries()) {
    await insertRow(db, 'audit_log', {
      id: 9800 + index,
      occurred_at: at(entry.when),
      installation_id: TENANT.id,
      actor_github_id: entry.actor.githubId,
      action: entry.action,
      subject_type: entry.subject[0],
      subject_id: entry.subject[1],
      metadata: JSON.stringify(entry.metadata),
    });
  }
  await insertRow(db, 'audit_log', {
    id: 9899,
    occurred_at: at('2026-02-02T09:00:00Z'),
    installation_id: FOREIGN_TENANT.id,
    actor_github_id: BOB.githubId,
    action: 'cla_document.created',
    subject_type: 'cla_document',
    subject_id: DOCUMENTS.foreign.id,
    metadata: JSON.stringify({ document_id: DOCUMENTS.foreign.id, kind: 'individual' }),
  });
}
