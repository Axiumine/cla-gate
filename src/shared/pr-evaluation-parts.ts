// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { ADVISORY_CODES, ALLOWLIST_KINDS, ALLOWLIST_SCOPES, ROLES, UNLINKED_ROLES } from './pr-evaluation-codes.ts';

// E08-S01: the pieces of the stored-details schema (pr-evaluation-details.ts). Every string in them is an enum member or
// a lower-case commit SHA, and every object is strict, so a name, login or email has no field to hide in.

/** A GitHub numeric id or a database id: a positive safe integer. Never a login. */
export const idSchema = z.int().positive();

/** A commit SHA as git prints it, lower case, SHA-1 (40) or SHA-256 (64) like the `commit_overrides` check. */
const shaSchema = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/);

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

/**
 * Why an actor is covered, as stored. A discriminated union on `kind`: E21 adds `corporate_approval` here as one more
 * member and no existing member changes.
 */
const coveringBasisSchema = z.discriminatedUnion('kind', [signatureBasisSchema, allowlistBasisSchema]);

export const actorSchema = z
  .strictObject({
    githubId: idSchema,
    roles: z.array(z.enum(ROLES)).min(1),
    covered: z.boolean(),
    basis: coveringBasisSchema.nullable(),
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
