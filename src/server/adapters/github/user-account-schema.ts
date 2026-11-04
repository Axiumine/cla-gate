// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { ALLOWLIST_LOGIN_PATTERN } from '../../../shared/allowlist.ts';
import { githubIdSchema } from '../../../shared/github-id.ts';

// The schema of the answer to the lookup of an account (E14-S06), in a file of its own so that `schemas.ts` stays under the cap on
// the complexity of a file. Like the others it keeps only the fields the platform uses and drops the rest.

/**
 * `GET /users/{username}` (E14-S06): an account by its login. The id must be a positive integer and the login the shape of a GitHub
 * login (`ALLOWLIST_LOGIN_PATTERN`), so markup in an answer is refused here and can never reach a snapshot a screen shows. A type
 * the platform has no word for is read as `Other`, which no kind of entry accepts; a missing type fails, as it is not a type.
 */
export const userAccountSchema = z.object({
  id: githubIdSchema,
  login: z.string().regex(ALLOWLIST_LOGIN_PATTERN),
  type: z.string().transform((type) => (type === 'User' || type === 'Bot' || type === 'Organization' ? type : 'Other')),
});
