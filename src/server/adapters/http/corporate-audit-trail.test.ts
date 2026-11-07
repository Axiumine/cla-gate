// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { AUDIT_LOG_PATH, auditLogPageSchema } from '../../../shared/audit-log.ts';
import { revokeAs, revokedOf } from './corporate-approval-fixture/test-support.ts';
import {
  ACME_DOMAIN,
  ACME_EMAIL,
  ACME_ORG,
  approveDomain,
  approveOrg,
  approvePerson,
  claimAs,
  claimWorld,
  employee,
  loginOf,
} from './corporate-claim-fixture/test-support.ts';
import { choiceUrl } from './corporate-fixture/test-support.ts';

// The audit trail of corporate CLA (E21-S05): every state change of epic E21 has an audit action, each row is readable through the audit log of the
// tenant (E16-S01), and no row names a person, a company or a domain. The five actions are written by the real routes of the stories that
// built them, one flow in one world, and read back through the same API a maintainer reads, with the personal data of the flow known.

const ACTIONS = [
  'corporate_agreement.signed',
  'corporate_approval.added',
  'corporate_approval.revoked',
  'corporate_approval.derived',
  'repository.corporate_document_set',
] as const;

/** The codes a metadata value may be when it is not a number: the kind of an approval and why it was written. */
const CODES = new Set(['user', 'github_org', 'email_domain', 'carried_over', 'parent_revoked', 'expired']);

/** Every state change of the epic, through its route, in a world whose personal data is told apart: the company, the title, the typed name, the address, the logins, the domain. */
async function worldWithEveryChange() {
  const world = await claimWorld();
  const emma = await employee(world, 8801, [ACME_EMAIL]);
  await employee(world, 7001, []);
  const domain = await approveDomain(world, ACME_DOMAIN);
  await approveOrg(world, ACME_ORG.login);
  const jane = await approvePerson(world, 7001);
  expect(
    (await claimAs(world, emma, world.t1.plain.githubRepoId)).statusCode,
    'the employee of the approved domain is covered',
  ).toBe(201);
  revokedOf(await revokeAs(world, world.ada, { agreementId: world.adas.id, approvalId: jane }));
  for (const documentId of [null, world.c1.document.documentId]) {
    const chosen = await world.ask('admin1', {
      method: 'PUT',
      url: choiceUrl(world.t1.installationId, world.t1.plain.repositoryId),
      payload: { documentId },
    });
    expect(chosen.statusCode).toBe(200);
  }
  return { world, domain };
}

/** The rows of `action` the audit log of tenant 1 shows to its org admin. */
async function logOf(world: Awaited<ReturnType<typeof claimWorld>>, action: (typeof ACTIONS)[number]) {
  const response = await world.ask('admin1', {
    method: 'GET',
    url: `${AUDIT_LOG_PATH.replace(':installationId', String(world.t1.installationId))}?action=${action}&limit=200`,
  });
  expect(response.statusCode).toBe(200);
  return auditLogPageSchema.parse(response.json()).items;
}

test('each of the five actions of epic E21 is written by its route and readable through the audit log of its tenant', async () => {
  const { world } = await worldWithEveryChange();
  for (const action of ACTIONS) {
    const items = await logOf(world, action);
    expect(items.length, action).toBeGreaterThan(0);
    expect(new Set(items.map((item) => item.action))).toEqual(new Set([action]));
  }
  expect(await logOf(world, 'corporate_approval.added')).toHaveLength(3);
  expect(await logOf(world, 'repository.corporate_document_set')).toHaveLength(2);
});

/** What the flow of {@link worldWithEveryChange} knows about people and companies, and no audit row may repeat. */
const PERSONAL = [
  'Acme GmbH',
  'Chief Legal Officer',
  'Ada Lovelace',
  'ada@example.org',
  ACME_EMAIL.email,
  ACME_DOMAIN,
  ACME_ORG.login,
  loginOf(8801),
  loginOf(7001),
];

/** One row holds none of {@link PERSONAL}, no key that names personal data, and only numbers, nulls and {@link CODES} as values. */
function expectIdsAndCodesOnly(
  action: string,
  item: { subject: unknown; metadata: Record<string, unknown> | null },
): void {
  const text = JSON.stringify({ subject: item.subject, metadata: item.metadata });
  for (const value of PERSONAL) {
    expect(text, `${action} must not hold ${value}`).not.toContain(value);
  }
  for (const [key, value] of Object.entries(item.metadata ?? {})) {
    expect(key, action).not.toMatch(/name|email|login|domain|company|title/);
    expect(
      value === null || typeof value === 'number' || (typeof value === 'string' && CODES.has(value)),
      `${action}.${key}`,
    ).toBe(true);
  }
}

test('no row names a company, a title, a typed name, an address, a login or a domain: ids and codes only, in every row and every key', async () => {
  const { world } = await worldWithEveryChange();
  for (const action of ACTIONS) {
    for (const item of await logOf(world, action)) {
      expectIdsAndCodesOnly(action, item);
    }
  }
});

test('the derived approval and the revocation name the approval and the signature of the agreement by number, and the cause as a code', async () => {
  const { world } = await worldWithEveryChange();
  const [derived] = await logOf(world, 'corporate_approval.derived');
  expect(derived).toMatchObject({
    subject: { type: 'corporate_approval' },
    metadata: { kind: 'user', github_id: 8801, signature_id: world.adas.signatureId, reason_code: null },
  });
  const [revoked] = await logOf(world, 'corporate_approval.revoked');
  expect(revoked?.metadata).toMatchObject({ kind: 'user', github_id: 7001, signature_id: world.adas.signatureId });
});

test('the audit log of the other tenant holds none of these rows', async () => {
  const { world } = await worldWithEveryChange();
  const response = await world.ask('admin2', {
    method: 'GET',
    url: `${AUDIT_LOG_PATH.replace(':installationId', String(world.t2.installationId))}?action=corporate_approval.added&limit=200`,
  });
  expect(auditLogPageSchema.parse(response.json()).items).toEqual([]);
});
