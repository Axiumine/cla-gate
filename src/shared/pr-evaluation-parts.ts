// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { ADVISORY_CODES, ALLOWLIST_KINDS, ALLOWLIST_SCOPES, ROLES, UNLINKED_ROLES } from './pr-evaluation-codes.ts';

// E08-S01: the pieces of the stored-details schema (pr-evaluation-details.ts). Every string in them is an enum member or
// a lower-case commit SHA, and every object is strict, so a name, login or email has no field to hide in.

/** A GitHub numeric id or a database id: a positive safe integer. Never a login. */
export const idSchema = z.int().positive();

/** A commit SHA as git prints it, lower case, SHA-1 (40) or SHA-256 (64) like the `commit_overrides` check. */
export const shaSchema = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);

export const countSchema = z.int().nonnegative();

const signatureBasisSchema = z.strictObject({
  kind: z.literal('signature'),
  signatureId: idSchema,
  versionId: idSchema,
  major: idSchema,
});

const allowlistBasisSchema = z.strictObject({
  kind: z.literal('allowlist'),
  entryId: idSchema,
  entryKind: z.enum(ALLOWLIST_KINDS),
  scope: z.enum(ALLOWLIST_SCOPES),
});

/** An approval of a corporate agreement covers the person (E21-S05): two numeric ids, never a company, a domain or a login. */
const corporateApprovalBasisSchema = z.strictObject({
  kind: z.literal('corporate_approval'),
  agreementId: idSchema,
  approvalId: idSchema,
});

/**
 * Why an actor is covered, as stored. A discriminated union on `kind`: E21-S05 added `corporate_approval` as one more
 * member and no existing member changed, so a row written before it still parses.
 */
const coveringBasisSchema = z.discriminatedUnion('kind', [
  signatureBasisSchema,
  allowlistBasisSchema,
  corporateApprovalBasisSchema,
]);

/**
 * One person or account of the pull request, as stored. `bot` is present, and `true`, only for an account GitHub reported as a Bot
 * (E15-S07): a person and a bot who are both uncovered fail with different codes and need different fixes, and the list of pending
 * pull requests must tell them apart without asking GitHub. A value stored before the mark existed lacks it and reads as not a bot.
 */
export const actorSchema = z
  .strictObject({
    githubId: idSchema,
    roles: z.array(z.enum(ROLES)).min(1).max(ROLES.length),
    covered: z.boolean(),
    basis: coveringBasisSchema.nullable(),
    bot: z.literal(true).optional(),
  })
  .refine((actor) => actor.covered === (actor.basis !== null), {
    message: 'An actor is covered exactly when it has a covering basis.',
  });

export const unlinkedSchema = z.strictObject({
  sha: shaSchema,
  role: z.enum(UNLINKED_ROLES),
  overrideId: idSchema.nullable(),
});

export const advisorySchema = z.strictObject({ code: z.enum(ADVISORY_CODES), sha: shaSchema });
