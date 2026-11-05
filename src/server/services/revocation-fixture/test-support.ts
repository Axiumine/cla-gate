// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { PrEvaluationDetails } from '../../../shared/pr-evaluation-details.ts';
import { insertEvaluation } from '../../adapters/db/pr-evaluation-links-fixture/test-support.ts';
import type { Database } from '../../adapters/db/schema.ts';
import { type TenantWorld, twoTenants } from '../../adapters/db/tenant-fixture/test-support.ts';
import { migratedTestDatabase } from '../../adapters/db/test-support.ts';
import { successDetails } from '../../domain/failure-details-fixture/test-support.ts';
import type { EnvelopeOf } from '../../domain/job-envelope.ts';
import { createJobsTable, fakeEnqueuer, type SentJob, sentJobs } from '../jobs-fixture/test-support.ts';
import type { SignatureRevocation } from '../signature-revoke.ts';

// The world of the tests of the re-evaluation a revocation asks for (E15-S03): two tenants whose repositories (`org-<n>/repo`, GitHub id
// `<n> * 9000`, and `org-<n>/scoped`, `<n> * 9000 + 1`) are on and enforce the tenant's installation-wide document, a fake queue on the
// same database, and a way to store the evaluation rows the revocation looks at.

/** A repository of tenant 1. */
export type WhichRepository = 'plain' | 'scoped';

/** The world: the database with the two tenants, the jobs table, and the fake queue. */
export async function revocationWorld() {
  const { db } = await migratedTestDatabase();
  const tenants = await twoTenants(db);
  await createJobsTable(db);
  for (const tenant of [tenants.t1, tenants.t2]) {
    await db
      .updateTable('repositories')
      .set({ enabled: true, cla_document_id: tenant.documentId })
      .where('id', 'in', [tenant.plain.repositoryId, tenant.scoped.repositoryId])
      .execute();
  }
  return { db, ...tenants, queue: fakeEnqueuer() };
}

/**
 * The details of a success that names `covered` as covered by a signature: the actor `githubId` with the basis `signatureId`, one per
 * entry, valid for the schema of E08.
 */
export function coveredBy(...covered: readonly { githubId: number; signatureId: number }[]): PrEvaluationDetails {
  const base = successDetails([]);
  return {
    ...base,
    actors: covered.map(({ githubId, signatureId }) => ({
      githubId,
      roles: ['author' as const],
      covered: true,
      basis: { kind: 'signature' as const, signatureId, versionId: 1, major: 1 },
    })),
  };
}

/** What a test chooses of a stored row; the rest is an open success. */
interface StoredPr {
  readonly prNumber: number;
  /** One digit, repeated into a head SHA. */
  readonly head?: string;
  readonly result?: 'success' | 'failure' | 'in_progress' | 'cancelled';
  readonly details: PrEvaluationDetails;
  /** The day of June 2026 the row was touched: the later one is the latest of the pull request. */
  readonly day?: number;
  readonly state?: 'open' | 'closed';
}

/** Stores an evaluation of a repository of `tenant` and answers its id. */
export async function storePr(
  db: Kysely<Database>,
  tenant: TenantWorld,
  which: WhichRepository,
  spec: StoredPr,
): Promise<number> {
  const repository = which === 'plain' ? tenant.plain : tenant.scoped;
  const id = await insertEvaluation(
    db,
    { installationId: tenant.installationId, repositoryId: repository.repositoryId },
    {
      prNumber: spec.prNumber,
      headSha: (spec.head ?? '1').repeat(40),
      result: spec.result ?? 'success',
      details: spec.details,
      updatedAt: new Date(Date.UTC(2026, 5, spec.day ?? 1)),
    },
  );
  if (spec.state === 'closed') {
    await db.updateTable('pr_evaluations').set({ pr_state: 'closed' }).where('id', '=', id).execute();
  }
  return id;
}

/** The revocation of the signature `signatureId` of tenant 1 by its admin. */
export function revocationBy(tenant: TenantWorld, signatureId: number): SignatureRevocation {
  return {
    signatureId,
    reason: 'maintainer_decision',
    actor: { userId: tenant.admin.userId, githubId: tenant.admin.githubId },
  };
}

/** An `evaluate-pr` or `sweep-repository` job: the two kinds a revocation sends. */
type Sent = EnvelopeOf<'evaluate-pr'> | EnvelopeOf<'sweep-repository'>;

const isSent = (job: SentJob['job']): job is Sent => job.type === 'evaluate-pr' || job.type === 'sweep-repository';

/** What was sent, as `<GitHub repository id>#<pull request>` for an evaluation and `sweep <GitHub repository id>` for a sweep, in the order sent. */
export async function sentAs(db: Kysely<Database>): Promise<string[]> {
  return (await sentJobs(db))
    .map(({ job }) => job)
    .filter(isSent)
    .map((job) => (job.type === 'evaluate-pr' ? `${job.githubRepoId}#${job.prNumber}` : `sweep ${job.githubRepoId}`));
}
