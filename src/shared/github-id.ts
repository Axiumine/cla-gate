// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';

/**
 * A numeric GitHub id (user, organisation or app account): a positive safe integer. The brand keeps the surrogate keys of
 * our own tables (`users.id`, `installations.id`) from being passed where a GitHub id is meant (E04-S09).
 */
export const githubIdSchema = z.int().positive().brand<'GithubId'>();

export type GithubId = z.infer<typeof githubIdSchema>;

/**
 * Brands `value` as a GitHub id. @throws ZodError when it is not a positive safe integer.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export function parseGithubId(value: unknown): GithubId {
  return githubIdSchema.parse(value);
}
