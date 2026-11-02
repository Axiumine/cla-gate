// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { githubIdSchema } from '../../../shared/github-id.ts';

// The schemas of GitHub's answers (E05-S02). Each keeps only the fields the platform uses and drops the rest, so an
// answer that grows a field is still read and nothing we do not need is held. Later stories add the schemas of their
// own routes here (E05-S04).

/** The account types an App can be installed on or owned by. Anything else fails validation. */
const accountTypeSchema = z.enum(['User', 'Organization']);

export type AccountType = z.infer<typeof accountTypeSchema>;

/**
 * `GET /app`: the App the JWT belongs to. `owner` is the account that owns the App; GitHub sends `null` for an App owned
 * by an enterprise, which fails here on purpose, because the admission policy needs an owner id (E05-S07).
 */
export const appSchema = z.object({
  id: githubIdSchema,
  slug: z.string().min(1),
  owner: z.object({ id: githubIdSchema, type: accountTypeSchema }),
  permissions: z.record(z.string(), z.string()),
});

export type AppResponse = z.infer<typeof appSchema>;
