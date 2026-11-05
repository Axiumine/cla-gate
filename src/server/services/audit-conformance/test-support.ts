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
const ALLOWLIST_ENTRY = { type: 'allowlist_entry', id: 31 } as const;
const COMMIT_OVERRIDE = { type: 'commit_override', id: 31 } as const;

/** The two commits an override call site writes a row for (E15-S05, E15-S06): a SHA-1 id and a SHA-256 one. */
function overrideFixtures(action: 'commit_override.created' | 'commit_override.deleted'): readonly AuditFixture[] {
  return ['a1b2c3d4e5f60718293a4b5c6d7e8f9012345678', '0123456789abcdef'.repeat(4)].map(
    (commitSha): AuditFixture => ({
      action,
      subject: COMMIT_OVERRIDE,
      metadata: { repository_id: 12, commit_sha: commitSha },
    }),
  );
}

/** The four rows an approval call site writes (E21-S03): a person, an organisation and a domain, and a person written because of the approval it derives from or was copied from. */
function approvalFixtures(action: 'corporate_approval.added' | 'corporate_approval.revoked'): readonly AuditFixture[] {
  const subject = { type: 'corporate_approval', id: 51 } as const;
  const because = action === 'corporate_approval.added' ? 'carried_over' : 'parent_revoked';
  return [
    { kind: 'user', github_id: 4711, reason_code: null },
    { kind: 'github_org', github_id: 9100, reason_code: null },
    { kind: 'email_domain', github_id: null, reason_code: null },
    { kind: 'user', github_id: 4711, reason_code: because },
  ].map((fields): AuditFixture => ({ action, subject, metadata: { ...fields, signature_id: 31 } }));
}

/** The three entries an allowlist call site writes a row for (E14-S06, E14-S07): one that covers the installation, one of a repository, and `org_members`. */
function allowlistFixtures(action: 'allowlist_entry.created' | 'allowlist_entry.deleted'): readonly AuditFixture[] {
  return [
    {
      action,
      subject: ALLOWLIST_ENTRY,
      metadata: { scope: 'installation', repository_id: null, kind: 'user', github_id: 4711 },
    },
    {
      action,
      subject: ALLOWLIST_ENTRY,
      metadata: { scope: 'repository', repository_id: 12, kind: 'bot', github_id: 49699333 },
    },
    {
      action,
      subject: ALLOWLIST_ENTRY,
      metadata: { scope: 'installation', repository_id: null, kind: 'org_members', github_id: 4242 },
    },
  ];
}

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
  'services/cla-document-changes.ts#cla_document.created': [
    {
      action: 'cla_document.created',
      subject: { type: 'cla_document', id: 12 },
      metadata: { document_id: 12, repository_id: null, kind: 'individual' },
    },
    {
      action: 'cla_document.created',
      subject: { type: 'cla_document', id: 13 },
      metadata: { document_id: 13, repository_id: 9000, kind: 'corporate' },
    },
  ],
  'services/cla-document-changes.ts#cla_document.renamed': [
    { action: 'cla_document.renamed', subject: { type: 'cla_document', id: 12 }, metadata: { document_id: 12 } },
  ],
  'services/cla-drafts.ts#cla_draft.discarded': [
    {
      action: 'cla_draft.discarded',
      subject: { type: 'cla_document', id: 12 },
      metadata: { document_id: 12, revision: 3 },
    },
  ],
  'services/cla-drafts.ts#cla_draft.saved': [
    {
      action: 'cla_draft.saved',
      subject: { type: 'cla_document', id: 12 },
      metadata: { document_id: 12, revision: 1 },
    },
  ],
  'services/cla-publish.ts#cla_version.published': [
    {
      action: 'cla_version.published',
      subject: { type: 'cla_version', id: 21 },
      metadata: { document_id: 12, version_id: 21, major: 1, minor: 0, bump: 'major', affected_signatures: 0 },
    },
    {
      action: 'cla_version.published',
      subject: { type: 'cla_version', id: 22 },
      metadata: {
        document_id: 12,
        version_id: 22,
        major: 1,
        minor: 1,
        bump: 'minor',
        affected_signatures: 40,
        rolled_back_from_version_id: 21,
      },
    },
  ],
  'services/sign-write.ts#signature.created': [
    {
      action: 'signature.created',
      subject: { type: 'signature', id: 31 },
      metadata: { document_id: 12, version_id: 21, major: 1, source_repository_id: 9, source_pr_number: 45 },
    },
    {
      action: 'signature.created',
      subject: { type: 'signature', id: 32 },
      metadata: { document_id: 12, version_id: 22, major: 2, source_repository_id: 9, source_pr_number: null },
    },
  ],
  'services/corporate-agreement-write.ts#corporate_agreement.signed': [
    {
      action: 'corporate_agreement.signed',
      subject: { type: 'corporate_agreement', id: 41 },
      metadata: { document_id: 12, version_id: 21, signature_id: 31, major: 1, source_repository_id: 9 },
    },
  ],
  'services/corporate-approval-audit.ts#corporate_approval.added|corporate_approval.derived|corporate_approval.revoked':
    [
      ...approvalFixtures('corporate_approval.added'),
      ...approvalFixtures('corporate_approval.revoked'),
      // E21-S04: the approval derived for an employee who claimed coverage is always a person's, and carries no cause.
      {
        action: 'corporate_approval.derived',
        subject: { type: 'corporate_approval', id: 51 },
        metadata: { kind: 'user', github_id: 4711, signature_id: 31, reason_code: null },
      },
    ],
  'services/repository-corporate-document.ts#repository.corporate_document_set': [
    {
      action: 'repository.corporate_document_set',
      subject: REPOSITORY,
      metadata: { repository_id: 12, document_id: 3, previous_document_id: null },
    },
    {
      action: 'repository.corporate_document_set',
      subject: REPOSITORY,
      metadata: { repository_id: 12, document_id: null, previous_document_id: 3 },
    },
  ],
  'services/signature-revoke-audit.ts#signature.revoked': [
    {
      action: 'signature.revoked',
      subject: { type: 'signature', id: 31 },
      metadata: { document_id: 12, version_id: 21, major: 1, user_github_id: 4711, reason_code: 'signer_request' },
    },
    {
      action: 'signature.revoked',
      subject: { type: 'signature', id: 32 },
      metadata: { document_id: 12, version_id: 22, major: 2, user_github_id: 4712, reason_code: 'maintainer_decision' },
    },
  ],
  'services/signature-invalidate.ts#signatures.invalidated': [
    {
      action: 'signatures.invalidated',
      subject: { type: 'document', id: 12 },
      metadata: { major: 1, count: 1, reason_code: 'maintainer_decision' },
    },
    {
      action: 'signatures.invalidated',
      subject: { type: 'document', id: 12 },
      metadata: { major: 2, count: 25_000, reason_code: 'legal_request' },
    },
  ],
  'services/dead-letter/dead-letter-sync.ts#installation.sync_failed': [
    {
      action: 'installation.sync_failed',
      subject: { type: 'installation', id: 77 },
      metadata: { reason_code: 'retries_exhausted' },
    },
  ],
  'services/repository-document-record.ts#repository.cla_document_attached|repository.cla_document_detached': [
    {
      action: 'repository.cla_document_attached',
      subject: REPOSITORY,
      metadata: { repository_id: 12, document_id: 3, previous_document_id: null },
    },
    {
      action: 'repository.cla_document_attached',
      subject: REPOSITORY,
      metadata: { repository_id: 12, document_id: 4, previous_document_id: 3 },
    },
    {
      action: 'repository.cla_document_detached',
      subject: REPOSITORY,
      metadata: { repository_id: 12, document_id: null, previous_document_id: 4 },
    },
  ],
  'services/repository-enabled.ts#repository.disabled|repository.enabled': [
    { action: 'repository.enabled', subject: REPOSITORY, metadata: { repository_id: 12, document_id: 3 } },
    { action: 'repository.enabled', subject: REPOSITORY, metadata: { repository_id: 12, document_id: null } },
    { action: 'repository.disabled', subject: REPOSITORY, metadata: { repository_id: 12 } },
  ],
  'services/commit-override-record.ts#commit_override.created': overrideFixtures('commit_override.created'),
  'services/commit-override-remove.ts#commit_override.deleted': overrideFixtures('commit_override.deleted'),
  'services/repository-public-verification.ts#repository.public_verification_changed': [
    {
      action: 'repository.public_verification_changed',
      subject: REPOSITORY,
      metadata: { repository_id: 12, enabled: true },
    },
    {
      action: 'repository.public_verification_changed',
      subject: REPOSITORY,
      metadata: { repository_id: 12, enabled: false },
    },
  ],
  'services/allowlist-entry-create.ts#allowlist_entry.created': allowlistFixtures('allowlist_entry.created'),
  'services/allowlist-entry-remove.ts#allowlist_entry.deleted': allowlistFixtures('allowlist_entry.deleted'),
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
  'services/retention/retention-sweep.ts#retention.swept': [
    { action: 'retention.swept', metadata: { webhook_deliveries: 5000, sessions: 0 } },
    { action: 'retention.swept', metadata: { webhook_deliveries: 0, sessions: 12 } },
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
