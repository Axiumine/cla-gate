// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { prNumberSchema, signContextParamsSchema } from '../../shared/sign-context.ts';

// What the address of the sign page holds (E18-S01): `/sign/$githubRepoId?pr=<n>`, the link of the pull request comment (E09).

/** Decimal digits with no sign, no leading zero, no exponent and no space: the only spelling of a repository id the link uses. */
const PLAIN_NUMBER = /^[1-9]\d{0,15}$/;

/**
 * The numeric GitHub repository id in the path, or `undefined` when the text is not one. The shape of the id is the one the
 * context endpoint accepts (a positive safe integer); `1e3`, `0x10`, ` 5` and `5.0` are not repository ids, and a path with one
 * is no page of the app.
 */
export function parseGithubRepoId(raw: string): number | undefined {
  if (!PLAIN_NUMBER.test(raw)) {
    return undefined;
  }
  const parsed = signContextParamsSchema.shape.githubRepoId.safeParse(Number(raw));
  return parsed.success ? parsed.data : undefined;
}

/**
 * `?pr=` of the sign page: a pull request number in the range the endpoint takes, else nothing. A value that is not one is
 * dropped instead of being sent on, so the page still loads the CLA of the repository.
 */
export const signSearchSchema = z.object({ pr: prNumberSchema.optional().catch(undefined) });
