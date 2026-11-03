// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type AuditAction, INSTANCE_ACTIONS, SYSTEM_ACTIONS } from '../../../shared/audit.ts';
import type { AuditMetadata } from '../../../shared/audit-metadata.ts';
import type { AuditEntry } from '../audit-entry.ts';
import type { AuditCallSite } from '../audit-scan/test-support.ts';
import { ACTOR } from '../test-support.ts';

// The metadata fixtures of E16-S01: for every call of `appendAudit` in the server, the objects that call writes, written
// out. The catalogue test inserts each one through the writer into the migrated database and holds the keys of the
// fixtures to the keys the type checker reads from the call, so a key a call starts to write that the checks do not know
// fails there and not in production.

/** One row a call site writes: the action, the subject if it names one, and the metadata object as the call builds it. */
export interface AuditFixture {
  readonly action: AuditAction;
  readonly subject?: { readonly type: string; readonly id: number };
  readonly metadata?: AuditMetadata;
}

/** The name of a call site in {@link SITE_FIXTURES}: its file and the actions it can write. Lines move; this does not. */
export const siteId = (site: Pick<AuditCallSite, 'file' | 'actions'>): string =>
  `${site.file}#${site.actions.join('|')}`;

const ORGANISATION = { account_id: 4242, account_type: 'organization' } as const;
const REPOSITORY = { type: 'repository', id: 9000 } as const;

/** The fixtures of every call site, by {@link siteId}. A call site added to the server needs an entry or the catalogue test fails. */
export const SITE_FIXTURES: Readonly<Record<string, readonly AuditFixture[]>> = {
  'services/installation-admission.ts#installation.admitted|installation.rejected': [
    { action: 'installation.admitted', subject: { type: 'installation', id: 77 }, metadata: ORGANISATION },
    {
      action: 'installation.rejected',
      subject: { type: 'installation', id: 77 },
      metadata: { account_id: 4243, account_type: 'user', reason_code: 'account_not_allowed' },
    },
    {
      action: 'installation.rejected',
      subject: { type: 'installation', id: 77 },
      metadata: { account_id: 4244, account_type: 'other', reason_code: 'policy_changed' },
    },
  ],
  'services/repository-enabled.ts#repository.disabled|repository.enabled': [
    { action: 'repository.enabled', subject: REPOSITORY, metadata: { repository_id: 12, document_id: 3 } },
    { action: 'repository.enabled', subject: REPOSITORY, metadata: { repository_id: 12, document_id: null } },
    { action: 'repository.disabled', subject: REPOSITORY, metadata: { repository_id: 12 } },
  ],
  'services/repository-audit.ts#repository.added|repository.removed|repository.renamed': [
    { action: 'repository.added', subject: REPOSITORY },
    { action: 'repository.renamed', subject: REPOSITORY },
    { action: 'repository.removed', subject: REPOSITORY, metadata: { reason_code: 'not_listed' } },
    { action: 'repository.removed', subject: REPOSITORY, metadata: { reason_code: 'access_lost' } },
    { action: 'repository.removed', subject: REPOSITORY, metadata: { reason_code: 'transferred' } },
  ],
  'services/export/signature-export-record.ts#signatures.exported': [
    { action: 'signatures.exported', subject: { type: 'document', id: 12 }, metadata: { state: 'all', row_count: 0 } },
    {
      action: 'signatures.exported',
      subject: { type: 'document', id: 12 },
      metadata: { state: 'active', row_count: 2500 },
    },
    {
      action: 'signatures.exported',
      subject: { type: 'document', id: 12 },
      metadata: { state: 'outdated', row_count: 1 },
    },
    {
      action: 'signatures.exported',
      subject: { type: 'document', id: 12 },
      metadata: { state: 'revoked', row_count: 1001 },
    },
  ],
  'services/export/own-data.ts#data_export.created': [
    { action: 'data_export.created', subject: { type: 'user', id: ACTOR }, metadata: { signature_count: 0 } },
    { action: 'data_export.created', subject: { type: 'user', id: ACTOR }, metadata: { signature_count: 3 } },
  ],
  'services/installation-sync-checks.ts#installation.suspended|installation.unsuspended': [
    { action: 'installation.suspended', subject: { type: 'installation', id: 77 }, metadata: ORGANISATION },
    { action: 'installation.unsuspended', subject: { type: 'installation', id: 77 }, metadata: ORGANISATION },
  ],
  'services/installation-sync-checks.ts#installation.updated': [
    { action: 'installation.updated', subject: { type: 'installation', id: 77 }, metadata: ORGANISATION },
  ],
  'services/installation-sync-deleted.ts#installation.deleted': [
    {
      action: 'installation.deleted',
      subject: { type: 'installation', id: 77 },
      metadata: { ...ORGANISATION, count: 5 },
    },
  ],
};

/** The entry a fixture stands for: system actions have no person, instance actions no tenant. */
export function entryOf(fixture: AuditFixture, installationId: number): AuditEntry {
  return {
    action: fixture.action,
    installationId: INSTANCE_ACTIONS.has(fixture.action) ? null : installationId,
    actorGithubId: SYSTEM_ACTIONS.has(fixture.action) ? null : ACTOR,
    ...(fixture.subject === undefined ? {} : { subject: fixture.subject }),
    ...(fixture.metadata === undefined ? {} : { metadata: fixture.metadata }),
  };
}

const sorted = (names: readonly string[]): string[] => [...new Set(names)].toSorted((a, b) => a.localeCompare(b));

const same = (left: readonly string[], right: readonly string[]): boolean =>
  sorted(left).join() === sorted(right).join();

/** The problems of one call site's fixtures: the actions, then the metadata keys, that they write together and the call does not. */
function siteProblems(
  id: string,
  rows: readonly AuditFixture[],
  own: readonly Pick<AuditCallSite, 'actions' | 'metadataKeys'>[],
): string[] {
  return [
    ...(same(
      rows.map((row) => row.action),
      own.flatMap((site) => site.actions),
    )
      ? []
      : [`${id}: the fixtures write other actions than the call`]),
    ...(same(
      rows.flatMap((row) => Object.keys(row.metadata ?? {})),
      own.flatMap((site) => site.metadataKeys),
    )
      ? []
      : [`${id}: the fixtures write other metadata keys than the call`]),
  ];
}

/**
 * What is wrong with the fixtures `fixtures` held to the call sites `sites`: a call site without fixtures, fixtures for a
 * call site that does not exist, and fixtures whose actions or metadata keys, together, differ from what the call can write.
 */
export function fixtureProblems(
  sites: readonly Pick<AuditCallSite, 'file' | 'actions' | 'metadataKeys'>[],
  fixtures: Readonly<Record<string, readonly AuditFixture[]>>,
): string[] {
  const ids = sorted(sites.map(siteId));
  return [
    ...ids.filter((id) => !Object.hasOwn(fixtures, id)).map((id) => `${id} has no fixture`),
    ...Object.keys(fixtures)
      .filter((id) => !ids.includes(id))
      .map((id) => `${id} has fixtures but no call site writes it`),
    ...Object.entries(fixtures)
      .filter(([id]) => ids.includes(id))
      .flatMap(([id, rows]) =>
        siteProblems(
          id,
          rows,
          sites.filter((site) => siteId(site) === id),
        ),
      ),
  ];
}
