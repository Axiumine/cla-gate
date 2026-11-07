// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Kysely, sql } from 'kysely';
import { expect } from 'vitest';
import {
  CORPORATE_AVAILABILITY_PATH,
  CORPORATE_CLAIMS_PATH,
  corporateAvailabilitySchema,
  corporateClaimAlreadyCoveredSchema,
  corporateClaimCoveredSchema,
} from '../../../../shared/corporate-claims.ts';
import { parseGithubId } from '../../../../shared/github-id.ts';
import type { VerifiedEmail } from '../../../../shared/verified-email.ts';
import type { EnvelopeOf } from '../../../domain/job-envelope.ts';
import { createJobsTable, fakeEnqueuer, sentJobs } from '../../../services/jobs-fixture/test-support.ts';
import type { JobEnqueuer } from '../../../services/ports/jobs.ts';
import type { Database } from '../../db/schema.ts';
import { publishVersion } from '../../db/test-support.ts';
import {
  type ApprovalWorld,
  addAs,
  addedOf,
  approvalWorld,
  changeAs,
} from '../corporate-approval-fixture/test-support.ts';
import { type Signer, signAs, signerWith, storeCorporateDocument } from '../corporate-fixture/test-support.ts';

// The world of the tests of the claim of an employee (E21-S04): the world of the approvals (both tenants with an agreement, Ada the CLA manager
// of tenant 1 and Bob of tenant 2, the fake GitHub both installations are known to) with a fake queue on the same database. Employees are made
// by `employee`: logged in with the verified addresses they have, and known to GitHub under the login the session keeps (`login-<id>`).

/** The domain the manager of tenant 1 approves in most tests, and an address in it. */
export const ACME_DOMAIN = 'acme.example';
export const ACME_EMAIL: VerifiedEmail = { email: 'emma@acme.example', primary: true };

/** The organisation of GitHub id 9100 (`Acme-Org`) the tests approve and show memberships of. */
export const ACME_ORG = { id: 9100, login: 'Acme-Org' } as const;

/** The world of the claims: the world of the approvals with a fake queue and its jobs table. */
export async function claimWorld(queue: JobEnqueuer = fakeEnqueuer()) {
  const world = await approvalWorld({ enqueuer: queue });
  await createJobsTable(world.db);
  return world;
}

export type ClaimWorld = Awaited<ReturnType<typeof claimWorld>>;

/** The login the session of `githubId` keeps (the authentication world names every person `login-<id>`). */
export const loginOf = (githubId: number): string => `login-${githubId}`;

/** An employee: logged in with `emails` as their verified addresses, and an account GitHub finds under their login. */
export async function employee(
  world: Pick<ClaimWorld, 'login' | 'db' | 'github'>,
  githubId: number,
  emails: readonly VerifiedEmail[] = [ACME_EMAIL],
): Promise<Signer> {
  world.github.scriptUserAccount(loginOf(githubId), {
    id: parseGithubId(githubId),
    login: loginOf(githubId),
    type: 'User',
  });
  return signerWith(world, githubId, emails);
}

/** The path of the availability of the repository GitHub knows as `githubRepoId`. */
const availabilityUrl = (githubRepoId: number | string): string =>
  CORPORATE_AVAILABILITY_PATH.replace(':githubRepoId', String(githubRepoId));

/** The path of the claims for the repository GitHub knows as `githubRepoId`. */
export const claimsUrl = (githubRepoId: number | string): string =>
  CORPORATE_CLAIMS_PATH.replace(':githubRepoId', String(githubRepoId));

/** Whether the repository offers the claim, as `who` (the session cookie only) or as nobody. */
export function availabilityAs(world: Pick<ClaimWorld, 'app'>, who: Signer | null, githubRepoId: number | string) {
  return world.app.inject({
    method: 'GET',
    url: availabilityUrl(githubRepoId),
    headers: who === null ? {} : { cookie: who.cookie },
  });
}

/** The claim of `who` for the repository, with `body` (the confirmation the page sends by default). */
export function claimAs(
  world: Pick<ClaimWorld, 'app'>,
  who: Signer,
  githubRepoId: number | string,
  body: unknown = { confirm: true },
) {
  return changeAs(world, who, { method: 'POST', url: claimsUrl(githubRepoId), body });
}

/** The availability of a `200`, parsed with the shared schema. */
export function availableOf(response: { statusCode: number; json: () => unknown }): boolean {
  expect(response.statusCode).toBe(200);
  return corporateAvailabilitySchema.parse(response.json()).corporateAvailable;
}

/** The status a claim answered with: the status code and the `status` of the body, both read with the shared schemas. */
export function claimOf(response: { statusCode: number; json: () => unknown }): [number, string] {
  const schema = response.statusCode === 201 ? corporateClaimCoveredSchema : corporateClaimAlreadyCoveredSchema;
  return [response.statusCode, schema.parse(response.json()).status];
}

/** An agreement of tenant 1 and the person who manages it: Ada and her own agreement unless a test says otherwise. */
interface Under {
  readonly agreementId: number;
  readonly manager: Signer;
}

/** The manager approves `body` (a domain, an organisation or a person) under the agreement, and answers the approval's id. */
async function approve(
  world: ApprovalWorld,
  body: Readonly<Record<string, unknown>>,
  under: Under = { agreementId: world.adas.id, manager: world.ada },
): Promise<number> {
  return addedOf(await addAs(world, under.manager, under.agreementId, body)).id;
}

/** The manager approves the e-mail domain. */
export const approveDomain = (world: ApprovalWorld, domain: string, under?: Under): Promise<number> =>
  approve(world, { kind: 'email_domain', domain }, under);

/** The manager approves the organisation `login`. */
export const approveOrg = (world: ApprovalWorld, login: string, under?: Under): Promise<number> =>
  approve(world, { kind: 'github_org', login }, under);

/** The manager approves the person who has the numeric GitHub id (known to the fake GitHub, as `employee` makes them). */
export const approvePerson = (world: ApprovalWorld, githubId: number, under?: Under): Promise<number> =>
  approve(world, { kind: 'user', login: loginOf(githubId) }, under);

/** The approvals of kind `user` of `githubId` as stored, oldest first: where each came from and when it ends and ended. */
export function userApprovalsOf(db: Kysely<Database>, githubId: number) {
  return db
    .selectFrom('corporate_approvals')
    .select([
      'id',
      'installation_id',
      'agreement_id',
      'source',
      'approved_by',
      'derived_from_approval_id',
      'approved_at',
      'expires_at',
      'revoked_at',
      'revoked_by',
      'revoke_reason',
      sql<number>`(extract(epoch from (expires_at - approved_at)) / 86400)::int`.as('lifetimeDays'),
    ])
    .where('kind', '=', 'user')
    .where('subject_github_id', '=', githubId)
    .orderBy('id')
    .execute();
}

/** The audit rows of the claim: the derivations and the revocations of expired approvals, oldest first. */
export function claimAuditOf(db: Kysely<Database>) {
  return db
    .selectFrom('audit_log')
    .selectAll()
    .where('action', 'in', ['corporate_approval.derived', 'corporate_approval.revoked'])
    .orderBy('id')
    .execute();
}

type SentJob = Awaited<ReturnType<typeof sentJobs>>[number];

/** Whether the job sent is an `evaluate-pr` one. */
const isEvaluation = (entry: SentJob): entry is SentJob & { readonly job: EnvelopeOf<'evaluate-pr'> } =>
  entry.job.type === 'evaluate-pr';

/** The `evaluate-pr` jobs sent so far, as `repository#number` with the key each was sent under. */
export async function evaluationsSent(db: Kysely<Database>): Promise<[string, string][]> {
  const sent = await sentJobs(db);
  return sent
    .filter(isEvaluation)
    .map(({ job, idempotencyKey }): [string, string] => [`${job.githubRepoId}#${job.prNumber}`, idempotencyKey]);
}

/**
 * A second corporate document of tenant 1 with its version 1.0 in force, which the scoped repository of the tenant is pointed at and enabled
 * for: a repository whose corporate CLA nobody has signed. Answers the document's id.
 */
export async function unsignedCorporateRepository(world: ClaimWorld): Promise<number> {
  const documentId = await storeCorporateDocument(world, { name: 'Second corporate CLA' });
  const version = await publishVersion(world.db, documentId, world.t1.publisherId, {
    major: 1,
    minor: 0,
    text: 'Second corporate terms',
  });
  await world.db
    .updateTable('cla_documents')
    .set({ active_version_id: version.id })
    .where('id', '=', documentId)
    .execute();
  await world.db
    .updateTable('repositories')
    .set({ enabled: true, corporate_document_id: documentId })
    .where('id', '=', world.t1.scoped.repositoryId)
    .execute();
  return documentId;
}

/** A second agreement of tenant 1 under the same corporate document and major, signed by Dana (GitHub id 4400): its id and its signature's. */
export async function secondAgreement(world: ClaimWorld) {
  const dana = await signerWith(world, 4400);
  const created = await signAs(world, dana, world.c1, { typedName: 'Dana Example', companyName: 'Dana Ltd' });
  return { dana, id: created.id, signatureId: created.signatureId, under: { agreementId: created.id, manager: dana } };
}

/** What the fake GitHub was asked, as `method` and the GitHub id of the installation that asked, in order. */
export const askedOf = (world: Pick<ClaimWorld, 'github'>): [string, number | undefined][] =>
  world.github.calls.map((call) => [call.method, call.installationId]);

/**
 * Stores, past the routes, an approval derived for `githubId` from the domain approval `parentId` of tenant 1's agreement that stopped covering
 * 35 days ago, a year after it began, and has not been revoked. Answers its id.
 */
export async function expireDerivedApproval(
  world: Pick<ClaimWorld, 'db' | 't1' | 'adas'>,
  derived: { readonly githubId: number; readonly parentId: number },
): Promise<number> {
  const day = 86_400_000;
  const row = await world.db
    .insertInto('corporate_approvals')
    .values({
      installation_id: world.t1.installationId,
      agreement_id: world.adas.id,
      kind: 'user',
      subject_github_id: derived.githubId,
      source: 'rule',
      derived_from_approval_id: derived.parentId,
      approved_at: new Date(Date.now() - 400 * day),
      expires_at: new Date(Date.now() - 35 * day),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/**
 * Stores, past the routes, `count` approvals of the manager for the organisations `org-1`, `org-2`, ... (GitHub ids 20001 and up) under tenant 1's
 * agreement, each with the login snapshot unless `withLogin` is false, and has the fake GitHub know every organisation.
 */
export async function seedOrgApprovals(
  world: Pick<ClaimWorld, 'db' | 't1' | 'adas' | 'ada' | 'github'>,
  seed: { readonly count: number; readonly withLogin: boolean },
): Promise<void> {
  for (let position = 1; position <= seed.count; position++) {
    const githubId = 20_000 + position;
    const row = await world.db
      .insertInto('corporate_approvals')
      .values({
        installation_id: world.t1.installationId,
        agreement_id: world.adas.id,
        kind: 'github_org',
        subject_github_id: githubId,
        source: 'manager',
        approved_by: world.ada.userId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    if (seed.withLogin) {
      await world.db
        .insertInto('corporate_approval_pii')
        .values({ approval_id: row.id, login: `org-${position}` })
        .execute();
      world.github.scriptUserAccount(`org-${position}`, {
        id: parseGithubId(githubId),
        login: `org-${position}`,
        type: 'Organization',
      });
    }
  }
}
