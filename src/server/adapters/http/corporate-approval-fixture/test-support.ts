// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { LightMyRequestResponse } from 'fastify';
import { type Kysely, sql } from 'kysely';
import { expect } from 'vitest';
import {
  type Approval,
  approvalCreatedSchema,
  approvalPageSchema,
  approvalRevokedSchema,
  CORPORATE_APPROVAL_PATH,
  CORPORATE_APPROVALS_PATH,
  CORPORATE_CARRY_OVER_PATH,
} from '../../../../shared/corporate-approvals.ts';
import { parseGithubId } from '../../../../shared/github-id.ts';
import type { GitHubUserAccount } from '../../../services/ports/github.ts';
import { FakeGitHub } from '../../../services/test-support.ts';
import type { TestAppOptions } from '../../../test-support.ts';
import type { Database } from '../../db/schema.ts';
import {
  type CorporateWorld,
  corporateChecksums,
  corporateWorld,
  type Signer,
  signAs,
  signerWith,
} from '../corporate-fixture/test-support.ts';

// The world of the tests of the approvals of a corporate agreement (E21-S03): the world of corporate signing, with a GitHub in memory
// that knows the accounts below, installed for both tenants. Ada (GitHub id 1234) signed for tenant 1, Bob (4321) for tenant 2.

/** A person, an organisation and a bot as GitHub knows them, by login. */
const account = (id: number, login: string, type: GitHubUserAccount['type']): GitHubUserAccount => ({
  id: parseGithubId(id),
  login,
  type,
});

/** A person GitHub keeps as `Jane-Doe`, id 7001. */
export const JANE = account(7001, 'Jane-Doe', 'User');
/** A second person, id 7002. */
const JOHN = account(7002, 'john-roe', 'User');
/** An organisation, id 9100. */
const ACME_ORG = account(9100, 'Acme-Org', 'Organization');
/** An automation. */
export const A_BOT = account(49_699_333, 'dependabot[bot]', 'Bot');

/**
 * The world of the approvals: both tenants with a signed agreement, and the fake GitHub both installations are known to. `app` adds the
 * options a test sets besides that GitHub (the queue a claim re-evaluates through, E21-S04).
 */
export async function approvalWorld(app: Pick<TestAppOptions, 'enqueuer'> = {}) {
  const github = new FakeGitHub();
  const world = await corporateWorld({}, { corporateGitHub: github, ...app });
  for (const { githubInstallationId, accountId, accountLogin } of [world.t1, world.t2]) {
    const owner = { id: accountId, login: accountLogin, type: 'Organization' } as const;
    github.addInstallation({ id: githubInstallationId, account: owner, suspendedAt: null, permissions: {} });
  }
  for (const known of [JANE, JOHN, ACME_ORG, A_BOT]) {
    github.scriptUserAccount(known.login, known);
  }
  const bob = await signerWith(world, 4321);
  const adas = await signAs(world, world.ada, world.c1);
  const bobs = await signAs(world, bob, world.c2, {
    typedName: 'Bob Example',
    companyName: 'Bob zzzz Ltd',
    signatoryTitle: 'CTO',
  });
  return { ...world, github, bob, adas, bobs };
}

export type ApprovalWorld = Awaited<ReturnType<typeof approvalWorld>>;

/** The path of the approvals of the agreement `agreementId`. */
export const approvalsUrl = (agreementId: number | string): string =>
  CORPORATE_APPROVALS_PATH.replace(':agreementId', String(agreementId));

/** The path of the approval `approvalId` of the agreement `agreementId`. */
export const approvalUrl = (agreementId: number | string, approvalId: number | string): string =>
  CORPORATE_APPROVAL_PATH.replace(':agreementId', String(agreementId)).replace(':approvalId', String(approvalId));

/** The path that copies approvals to the agreement `agreementId`. */
export const carryOverUrl = (agreementId: number | string): string =>
  CORPORATE_CARRY_OVER_PATH.replace(':agreementId', String(agreementId));

/** A request that changes something, as the page sends it: JSON with the session cookie, the `Origin` and the CSRF token of `who`. */
export function changeAs(
  world: Pick<CorporateWorld, 'app'>,
  who: Signer,
  request: { readonly method: 'POST' | 'DELETE'; readonly url: string; readonly body?: unknown },
): Promise<LightMyRequestResponse> {
  const { method, url, body } = request;
  return world.app.inject({
    method,
    url,
    headers: body === undefined ? who.headers : { ...who.headers, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
}

/** Adds the approval `body` under the agreement `agreementId` as `who`. */
export function addAs(world: Pick<CorporateWorld, 'app'>, who: Signer, agreementId: number, body: unknown) {
  return changeAs(world, who, { method: 'POST', url: approvalsUrl(agreementId), body });
}

/** Revokes the approval `approvalId` of the agreement `agreementId` as `who`, with `body` (none for a revocation with no reason). */
export function revokeAs(
  world: Pick<CorporateWorld, 'app'>,
  who: Signer,
  ids: { readonly agreementId: number; readonly approvalId: number },
  body?: unknown,
) {
  return changeAs(world, who, { method: 'DELETE', url: approvalUrl(ids.agreementId, ids.approvalId), body });
}

/** Copies the approvals of `fromAgreementId` to `agreementId` as `who`. */
export function carryOverAs(world: Pick<CorporateWorld, 'app'>, who: Signer, agreementId: number, body: unknown) {
  return changeAs(world, who, { method: 'POST', url: carryOverUrl(agreementId), body });
}

/** The approval of a `201`, parsed with the shared schema. */
export function addedOf(response: { statusCode: number; json: () => unknown }): Approval {
  expect(response.statusCode).toBe(201);
  return approvalCreatedSchema.parse(response.json()).approval;
}

/** The page of a `200`, parsed with the shared schema. */
export function pageOf(response: { statusCode: number; json: () => unknown }) {
  expect(response.statusCode).toBe(200);
  return approvalPageSchema.parse(response.json());
}

/** The answer of a `200` revocation, parsed with the shared schema. */
export function revokedOf(response: { statusCode: number; json: () => unknown }) {
  expect(response.statusCode).toBe(200);
  return approvalRevokedSchema.parse(response.json());
}

/** The approvals of an agreement as stored, oldest first: what the subject is, where it came from and whether it was revoked. */
export function storedApprovals(db: Kysely<Database>, agreementId: number) {
  return db
    .selectFrom('corporate_approvals')
    .select(['id', 'kind', 'subject_github_id', 'subject_domain', 'source', 'revoked_at', 'revoke_reason'])
    .where('agreement_id', '=', agreementId)
    .orderBy('id')
    .execute();
}

/** The audit rows of `action`, oldest first. */
export function auditRowsOf(db: Kysely<Database>, action: 'corporate_approval.added' | 'corporate_approval.revoked') {
  return db.selectFrom('audit_log').selectAll().where('action', '=', action).orderBy('id').execute();
}

/** Stores `count` user approvals of the manager under the agreement, past the routes, for people with ids from 100001 up. */
export async function seedUserApprovals(
  db: Kysely<Database>,
  agreement: { readonly installationId: number; readonly agreementId: number; readonly userId: number },
  count: number,
): Promise<void> {
  await sql`
    insert into corporate_approvals (installation_id, agreement_id, kind, subject_github_id, source, approved_by)
    select ${agreement.installationId}, ${agreement.agreementId}, 'user', 100000 + n, 'manager', ${agreement.userId}
    from generate_series(1, ${count}::int) as n`.execute(db);
}

/** The signature of an agreement was revoked (by the org admin of the tenant): the agreement can no longer be changed. */
export async function revokeSignature(world: ApprovalWorld, signatureId: number): Promise<void> {
  await world.db
    .updateTable('signatures')
    .set({
      revoked_at: new Date(Date.now() + 1000),
      revoked_by: world.t1.publisherId,
      revoke_reason: 'maintainer_decision',
    })
    .where('id', '=', signatureId)
    .execute();
}

/** GitHub suspended the installation of tenant 1. */
export async function suspendTenantOne(world: Pick<ApprovalWorld, 'db' | 't1'>): Promise<void> {
  await world.db
    .updateTable('installations')
    .set({ suspended_at: new Date('2026-10-01T00:00:00Z') })
    .where('id', '=', world.t1.installationId)
    .execute();
}

/** Everything the approvals touch: a hash of every table of the corporate CLA and the number of audit rows. Equal results mean nothing was written in between. */
export async function stateOf(db: Kysely<Database>) {
  const audit = await db
    .selectFrom('audit_log')
    .select((eb) => eb.fn.countAll().as('n'))
    .executeTakeFirstOrThrow();
  return { corporate: await corporateChecksums(db), audit: Number(audit.n) };
}
