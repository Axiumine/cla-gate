// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import {
  approve,
  type CorporateDocument,
  type CorporateTenant,
  corporateTenant,
  daysFromNow,
  insertApprovalRow,
  validUserRow,
} from '../../../adapters/db/corporate-fixture/test-support.ts';
import type { InstallationRowId } from '../../../adapters/db/installation-row-id.ts';
import type { Database } from '../../../adapters/db/schema.ts';
import { publishVersion, sha256 } from '../../../adapters/db/test-support.ts';
import { type EvaluateWorld, evaluateWorld } from '../test-support.ts';

// The world of the tests of the corporate coverage of an evaluation (E21-S05): the world of the `evaluate-pr` job with the real engine, whose
// tenant also has a corporate document that its repository enforces next to the individual one, an agreement signed by user 7 (who opens the
// pull request, so the opener is covered by the signatory's own approval) and helpers that change what the approvals say. The commits of the
// pull request are by users 1 and 2, so the three people to cover are 7, 1 and 2, and nobody has signed the individual CLA.

/** A world whose tenant has the corporate agreement of {@link corporateTenant}, signed by user 7, and a repository that enforces its document. */
export interface CorporateWorld {
  readonly world: EvaluateWorld;
  readonly corporate: CorporateTenant;
  /** A user approval by the manager for the person; returns the id of the approval. */
  readonly approvePerson: (githubId: number) => Promise<number>;
  /** Revokes the approval, as a manager would. */
  readonly revokeApproval: (approvalId: number) => Promise<void>;
  /** Revokes the signature of the agreement, as an org admin would. */
  readonly revokeAgreement: () => Promise<void>;
  /** Publishes the next major of the corporate document and makes it the active one, so the agreement is outdated. */
  readonly publishNextMajor: () => Promise<CorporateDocument>;
}

const NEXT_TEXT = 'The second major of the corporate terms.';

/** Sets the corporate document of every repository of the tenant. */
async function enforceCorporateDocument(
  db: Kysely<Database>,
  installationId: InstallationRowId,
  documentId: number | null,
) {
  await db
    .updateTable('repositories')
    .set({ corporate_document_id: documentId })
    .where('installation_id', '=', installationId)
    .execute();
}

/** The world, with the corporate document enforced unless `enforce` says it is not, and the runtime role in place for `runtime`. */
export async function corporateWorld(
  options: { readonly enforce?: boolean; readonly cla?: boolean; readonly runtime?: boolean } = {},
): Promise<CorporateWorld> {
  const world = await evaluateWorld({ engine: true, cla: options.cla ?? true, runtime: options.runtime ?? false });
  const corporate = await corporateTenant(world.raw, world.tenant, 7);
  if (options.enforce !== false) {
    await enforceCorporateDocument(world.raw, world.tenant.installationId, corporate.document.documentId);
  }
  return {
    world,
    corporate,
    approvePerson: (githubId) =>
      approve(world.raw, corporate.signed, { kind: 'user', githubId, login: `login-${githubId}` }),
    revokeApproval: async (approvalId) => {
      await world.raw
        .updateTable('corporate_approvals')
        .set({ revoked_at: new Date(), revoked_by: corporate.signed.person.userId, revoke_reason: 'test' })
        .where('id', '=', approvalId)
        .execute();
    },
    revokeAgreement: async () => {
      await world.raw
        .updateTable('signatures')
        .set({ revoked_at: new Date(), revoked_by: world.tenant.publisherId, revoke_reason: 'maintainer_decision' })
        .where('id', '=', corporate.signed.signatureId)
        .execute();
    },
    publishNextMajor: async () => {
      const version = await publishVersion(world.raw, corporate.document.documentId, world.tenant.publisherId, {
        major: 2,
        minor: 0,
        text: NEXT_TEXT,
      });
      await world.raw
        .updateTable('cla_documents')
        .set({ active_version_id: version.id })
        .where('id', '=', corporate.document.documentId)
        .execute();
      return {
        documentId: corporate.document.documentId,
        versionId: version.id,
        major: 2,
        contentSha256: sha256(NEXT_TEXT),
      };
    },
  };
}

/** The columns of an approval of a rule for the person that stopped covering 35 days ago (it was made 400 days ago and lasted 365). */
function expiredRuleRow(corporate: CorporateTenant, githubId: number): Record<string, unknown> {
  return {
    ...validUserRow(corporate, githubId),
    source: 'rule',
    approved_by: null,
    derived_from_approval_id: corporate.domainApproval,
    approved_at: daysFromNow(-400),
    expires_at: daysFromNow(-35),
  };
}

/** Stores the expired rule approval of {@link expiredRuleRow}. */
export function storeExpiredApproval(
  db: Kysely<Database>,
  corporate: CorporateTenant,
  githubId: number,
): Promise<number> {
  return insertApprovalRow(db, expiredRuleRow(corporate, githubId));
}
