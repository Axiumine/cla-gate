// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { githubIdSchema } from './github-id.ts';

// The erasure of a signer's personal data by an org admin (E16-S04): the two paths, the body of the request and the shape of
// the two answers. The routes, their tests and the screen that asks the admin to confirm share them. Counts and numeric ids
// only: neither an answer nor a request ever carries a login, a name or an email.

/**
 * Where an org admin asks what an erasure would remove: `:installationId` is `installations.id`, the tenant key of our own
 * tables, never GitHub's installation id (E11-S05). The person is named in the query string by `githubUserId`.
 */
export const ERASURE_PREVIEW_PATH = '/api/installations/:installationId/erasure-preview';

/** Where an org admin erases the personal data one installation holds for one person. */
export const ERASURES_PATH = '/api/installations/:installationId/erasures';

/**
 * What an erasure of the person would remove from the installation: how many signatures the person has there (they stay,
 * valid), how many rows of personal data are held for them (`signer_pii`), which is what the admin confirms, and how many
 * allowlist entries name them (they stay, and the login shown with each is cleared), and how many approvals of a corporate agreement
 * name them (they stay, and the login snapshot kept with each is deleted).
 */
export const erasurePreviewSchema = z.object({
  githubUserId: githubIdSchema,
  signatures: z.int().nonnegative(),
  signerPiiRows: z.int().nonnegative(),
  allowlistEntries: z.int().nonnegative(),
  corporateApprovals: z.int().nonnegative(),
});

/**
 * The request to erase: the person by their numeric GitHub id (never a login) and the number of rows the admin saw in the
 * preview. The server erases only when that is still the number it would delete.
 */
export const erasureRequestSchema = z.strictObject({
  githubUserId: githubIdSchema,
  expectedRows: z.int().nonnegative(),
});

/** What an erasure removed: the number of `signer_pii` rows deleted. */
export const erasureResultSchema = z.object({ erasedRows: z.int().nonnegative() });
