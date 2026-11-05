// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { NO_MATCHING_APPROVAL_HINT } from '../../../shared/corporate-claims.ts';
import { parseGithubId } from '../../../shared/github-id.ts';
import { revokeAs, revokeSignature, suspendTenantOne } from './corporate-approval-fixture/test-support.ts';
import {
  ACME_DOMAIN,
  ACME_ORG,
  approveDomain,
  approveOrg,
  approvePerson,
  askedOf,
  claimAs,
  claimOf,
  claimWorld,
  employee,
  loginOf,
  secondAgreement,
  userApprovalsOf,
} from './corporate-claim-fixture/test-support.ts';
import { detailsOf, failureOf, publishMajor } from './corporate-fixture/test-support.ts';

// What covers an employee who claims (E21-S04): the agreements of the repository's tenant in ascending id and, in each, the person's own approval,
// the domain of a verified address, then an organisation they show a membership of. The first match wins, and a domain never costs a call to GitHub.

const EMMA = 7101;

test('a verified address in an approved domain covers the employee: 201, one approval derived from the domain approval, a year long, and GitHub is not asked', async () => {
  const world = await claimWorld();
  const parent = await approveDomain(world, ACME_DOMAIN);
  const emma = await employee(world, EMMA);
  expect(claimOf(await claimAs(world, emma, world.t1.plain.githubRepoId))).toEqual([201, 'covered']);
  const rows = await userApprovalsOf(world.db, EMMA);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    installation_id: world.t1.installationId,
    agreement_id: world.adas.id,
    source: 'rule',
    approved_by: null,
    derived_from_approval_id: parent,
    revoked_at: null,
    lifetimeDays: 365,
  });
  const pii = await world.db
    .selectFrom('corporate_approval_pii')
    .select('login')
    .where('approval_id', '=', rows[0]?.id ?? 0)
    .execute();
  expect(pii).toEqual([{ login: loginOf(EMMA) }]);
  expect(askedOf(world)).toEqual([]);
});

test.each([
  ['an address in capitals', 'EMMA@ACME.EXAMPLE', 201],
  ['a second address of the same domain', 'emma@Acme.Example', 201],
  ['a domain that only ends with the approved one', 'emma@evilacme.example', 409],
  ['a subdomain, which is not implied', 'emma@mail.acme.example', 409],
  ['the approved domain as the start of another', 'emma@acme.example.evil.test', 409],
  ['a domain that only contains the approved one', 'emma@xacme.example.org', 409],
] as const)('%s: %i', async (_name, email, status) => {
  const world = await claimWorld();
  await approveDomain(world, ACME_DOMAIN);
  const emma = await employee(world, EMMA, [{ email, primary: true }]);
  expect((await claimAs(world, emma, world.t1.plain.githubRepoId)).statusCode).toBe(status);
});

test('any of the verified addresses may match, not only the primary one', async () => {
  const world = await claimWorld();
  await approveDomain(world, ACME_DOMAIN);
  const emma = await employee(world, EMMA, [
    { email: 'emma@gmail.example', primary: true },
    { email: 'emma@acme.example', primary: false },
  ]);
  expect(claimOf(await claimAs(world, emma, world.t1.plain.githubRepoId))).toEqual([201, 'covered']);
});

test.each([
  ['the domain with the lower approval comes first among the addresses', ['emma@first.example', 'emma@second.example']],
  ['the domain with the lower approval comes last among the addresses', ['emma@second.example', 'emma@first.example']],
])(
  'two approved domains of one agreement derive from the lower approval, whatever the order of the addresses: %s',
  async (_name, addresses) => {
    const world = await claimWorld();
    const first = await approveDomain(world, 'first.example');
    const second = await approveDomain(world, 'second.example');
    expect(second).toBeGreaterThan(first);
    const emma = await employee(
      world,
      EMMA,
      addresses.map((email) => ({ email, primary: false })),
    );
    expect(claimOf(await claimAs(world, emma, world.t1.plain.githubRepoId))).toEqual([201, 'covered']);
    const rows = await userApprovalsOf(world.db, EMMA);
    expect(rows.map((row) => row.derived_from_approval_id)).toEqual([first]);
  },
);

test('a membership of an approved organisation covers the employee, after GitHub confirmed the account, the organisation and the membership, as the tenant', async () => {
  const world = await claimWorld();
  const parent = await approveOrg(world, 'acme-org');
  world.github.scriptPublicMember(ACME_ORG.login, loginOf(EMMA), true);
  const emma = await employee(world, EMMA, []);
  const before = askedOf(world).length;
  expect(claimOf(await claimAs(world, emma, world.t1.plain.githubRepoId))).toEqual([201, 'covered']);
  const installation = world.t1.githubInstallationId;
  expect(askedOf(world).slice(before)).toEqual([
    ['getUserAccount', installation],
    ['getOrganizationAccount', installation],
    ['isPublicOrgMember', installation],
  ]);
  const [row] = await userApprovalsOf(world.db, EMMA);
  expect(row).toMatchObject({ source: 'rule', derived_from_approval_id: parent, agreement_id: world.adas.id });
});

test('a person who does not show a membership, or is not a member, is not covered by the organisation', async () => {
  const world = await claimWorld();
  await approveOrg(world, 'acme-org');
  const emma = await employee(world, EMMA, []);
  const response = await claimAs(world, emma, world.t1.plain.githubRepoId);
  expect(failureOf(response)).toEqual([409, 'no_matching_approval']);
  expect(await userApprovalsOf(world.db, EMMA)).toEqual([]);
});

test('a login that GitHub now gives to somebody else, or an organisation that is now another one, is not trusted: no membership is asked', async () => {
  const world = await claimWorld();
  await approveOrg(world, 'acme-org');
  const emma = await employee(world, EMMA, []);
  world.github.scriptPublicMember(ACME_ORG.login, loginOf(EMMA), true);
  world.github.scriptUserAccount(loginOf(EMMA), { id: parseGithubId(5555), login: loginOf(EMMA), type: 'User' });
  expect(failureOf(await claimAs(world, emma, world.t1.plain.githubRepoId))).toEqual([409, 'no_matching_approval']);
  world.github.scriptUserAccount(loginOf(EMMA), { id: parseGithubId(7101), login: loginOf(EMMA), type: 'User' });
  world.github.scriptUserAccount('Acme-Org', { id: parseGithubId(9999), login: 'Acme-Org', type: 'Organization' });
  expect(failureOf(await claimAs(world, emma, world.t1.plain.githubRepoId))).toEqual([409, 'no_matching_approval']);
  expect(askedOf(world).map(([method]) => method)).not.toContain('isPublicOrgMember');
});

test("within an agreement the domain comes before the organisation: the approval derived is the domain's and GitHub is not asked", async () => {
  const world = await claimWorld();
  await approveOrg(world, 'acme-org');
  world.github.scriptPublicMember(ACME_ORG.login, loginOf(EMMA), true);
  const emma = await employee(world, EMMA);
  const domain = await approveDomain(world, ACME_DOMAIN);
  const before = askedOf(world).length;
  expect(claimOf(await claimAs(world, emma, world.t1.plain.githubRepoId))).toEqual([201, 'covered']);
  expect((await userApprovalsOf(world.db, EMMA))[0]?.derived_from_approval_id).toBe(domain);
  expect(askedOf(world)).toHaveLength(before);
});

test('within an agreement the own approval comes before the domain and the organisation: already covered, and nothing derived', async () => {
  const world = await claimWorld();
  const emma = await employee(world, EMMA);
  await approveOrg(world, 'acme-org');
  await approveDomain(world, ACME_DOMAIN);
  const own = await approvePerson(world, EMMA);
  const before = askedOf(world).length;
  expect(claimOf(await claimAs(world, emma, world.t1.plain.githubRepoId))).toEqual([200, 'already_covered']);
  expect((await userApprovalsOf(world.db, EMMA)).map((row) => [row.id, row.source])).toEqual([[own, 'manager']]);
  expect(askedOf(world)).toHaveLength(before);
});

test('an employee who has an approval of their own in force is already covered: 200, nothing written, no audit row, GitHub not asked', async () => {
  const world = await claimWorld();
  const emma = await employee(world, EMMA);
  const own = await approvePerson(world, EMMA);
  const before = askedOf(world).length;
  expect(claimOf(await claimAs(world, emma, world.t1.plain.githubRepoId))).toEqual([200, 'already_covered']);
  expect((await userApprovalsOf(world.db, EMMA)).map((row) => [row.id, row.source])).toEqual([[own, 'manager']]);
  expect(askedOf(world)).toHaveLength(before);
  const derived = await world.db
    .selectFrom('audit_log')
    .select('id')
    .where('action', '=', 'corporate_approval.derived')
    .execute();
  expect(derived).toEqual([]);
});

test('the agreements are walked in ascending id: a rule of the first agreement wins over an approval of the person in the second', async () => {
  const world = await claimWorld();
  const second = await secondAgreement(world);
  const emma = await employee(world, EMMA);
  const own = await approvePerson(world, EMMA, second.under);
  const domain = await approveDomain(world, ACME_DOMAIN);
  expect(claimOf(await claimAs(world, emma, world.t1.plain.githubRepoId))).toEqual([201, 'covered']);
  const rows = await userApprovalsOf(world.db, EMMA);
  const derived = rows.filter((row) => row.source === 'rule');
  expect(derived.map((row) => [row.agreement_id, row.derived_from_approval_id])).toEqual([[world.adas.id, domain]]);
  expect(rows.map((row) => row.id)).toContain(own);
});

test("with nothing in the first agreement the second one decides: the person's approval in it makes them already covered, a domain in it derives one there", async () => {
  const world = await claimWorld();
  const second = await secondAgreement(world);
  const emma = await employee(world, EMMA);
  await approvePerson(world, EMMA, second.under);
  expect(claimOf(await claimAs(world, emma, world.t1.plain.githubRepoId))).toEqual([200, 'already_covered']);
  const fresh = await claimWorld();
  const later = await secondAgreement(fresh);
  const domain = await approveDomain(fresh, ACME_DOMAIN, later.under);
  const frank = await employee(fresh, 7103);
  expect(claimOf(await claimAs(fresh, frank, fresh.t1.plain.githubRepoId))).toEqual([201, 'covered']);
  const [row] = await userApprovalsOf(fresh.db, 7103);
  expect(row).toMatchObject({ agreement_id: later.id, derived_from_approval_id: domain });
});

test('nothing covers the person: 409 no_matching_approval with a fixed hint that names no company, and nothing is written', async () => {
  const world = await claimWorld();
  await approveDomain(world, 'globex.example');
  const emma = await employee(world, EMMA);
  const response = await claimAs(world, emma, world.t1.plain.githubRepoId);
  expect(failureOf(response)).toEqual([409, 'no_matching_approval']);
  expect(detailsOf(response)).toEqual({ hint: NO_MATCHING_APPROVAL_HINT });
  expect(response.body).not.toMatch(/Acme GmbH|Bob zzzz|globex/iu);
  expect(await userApprovalsOf(world.db, EMMA)).toEqual([]);
  const otherRepository = await claimAs(world, emma, world.t2.plain.githubRepoId);
  expect(otherRepository.body.replace(/"requestId":"[^"]*"/u, '')).toBe(
    response.body.replace(/"requestId":"[^"]*"/u, ''),
  );
});

test('an agreement whose signature was revoked, and one signed under an earlier major, cover nobody: 409', async () => {
  const world = await claimWorld();
  await approveDomain(world, ACME_DOMAIN);
  const emma = await employee(world, EMMA);
  await revokeSignature(world, world.adas.signatureId);
  expect(failureOf(await claimAs(world, emma, world.t1.plain.githubRepoId))).toEqual([409, 'no_matching_approval']);
  const other = await claimWorld();
  await approveDomain(other, ACME_DOMAIN);
  await publishMajor(other, other.c1, 2);
  const emmaAgain = await employee(other, EMMA);
  expect(failureOf(await claimAs(other, emmaAgain, other.t1.plain.githubRepoId))).toEqual([
    409,
    'no_matching_approval',
  ]);
  expect(await userApprovalsOf(other.db, EMMA)).toEqual([]);
});

test('an own approval does not cover under an agreement of an earlier major either', async () => {
  const world = await claimWorld();
  const emma = await employee(world, EMMA);
  await approvePerson(world, EMMA);
  await publishMajor(world, world.c1, 2);
  expect(failureOf(await claimAs(world, emma, world.t1.plain.githubRepoId))).toEqual([409, 'no_matching_approval']);
});

test('an approval the manager revoked covers nobody: the domain stops matching, and the employee derived from it is revoked with it', async () => {
  const world = await claimWorld();
  const domain = await approveDomain(world, ACME_DOMAIN);
  const emma = await employee(world, EMMA);
  expect(claimOf(await claimAs(world, emma, world.t1.plain.githubRepoId))).toEqual([201, 'covered']);
  expect((await revokeAs(world, world.ada, { agreementId: world.adas.id, approvalId: domain })).statusCode).toBe(200);
  const rows = await userApprovalsOf(world.db, EMMA);
  expect(rows.map((row) => row.revoked_at !== null)).toEqual([true]);
  expect(failureOf(await claimAs(world, emma, world.t1.plain.githubRepoId))).toEqual([409, 'no_matching_approval']);
});

test("a domain approved in one tenant covers nobody in another: Bob's domain does not cover a claim for tenant 1, and Ada's does not cover tenant 2", async () => {
  const world = await claimWorld();
  await approveDomain(world, ACME_DOMAIN, { agreementId: world.bobs.id, manager: world.bob });
  const emma = await employee(world, EMMA);
  expect(failureOf(await claimAs(world, emma, world.t1.plain.githubRepoId))).toEqual([409, 'no_matching_approval']);
  expect(claimOf(await claimAs(world, emma, world.t2.plain.githubRepoId))).toEqual([201, 'covered']);
  const [row] = await userApprovalsOf(world.db, EMMA);
  expect(row).toMatchObject({ installation_id: world.t2.installationId, agreement_id: world.bobs.id });
  const other = await claimWorld();
  await approveDomain(other, ACME_DOMAIN);
  const frank = await employee(other, 7103);
  expect(failureOf(await claimAs(other, frank, other.t2.plain.githubRepoId))).toEqual([409, 'no_matching_approval']);
  expect(await userApprovalsOf(other.db, 7103)).toEqual([]);
});

test('a repository that does not exist, one with no corporate CLA and one of a suspended tenant answer with their own rule', async () => {
  const world = await claimWorld();
  const emma = await employee(world, EMMA);
  expect(failureOf(await claimAs(world, emma, 987_654))).toEqual([404, 'not_found']);
  expect(failureOf(await claimAs(world, emma, world.t1.scoped.githubRepoId))).toEqual([
    404,
    'corporate_cla_not_configured',
  ]);
  await suspendTenantOne(world);
  expect(failureOf(await claimAs(world, emma, world.t1.plain.githubRepoId))).toEqual([409, 'installation_suspended']);
});
