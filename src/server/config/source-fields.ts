// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { commitSchema, sourceUrlSchema } from '../../shared/meta.ts';

// The two settings that say where the corresponding source of the running version is (E17-S09, AGPL section 13).

/** One trailing slash is forgiven (`https://github.com/org/repo/`); the shared schema then holds the rest to its rules. */
function withoutTrailingSlash(value: string): string {
  const trimmed = value.trim();
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}

/** `SOURCE_URL`: an https address without credentials, query or fragment. */
export const sourceUrlField = z.string().transform(withoutTrailingSlash).pipe(sourceUrlSchema);

/**
 * @returns the commit id in lower case, or `null` for a blank value and for `unknown` (what a build that does not know its
 * commit passes: `docker build --build-arg SOURCE_COMMIT=unknown`); anything else is left for the schema to refuse.
 */
function commitOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' || trimmed === 'unknown' ? null : trimmed.toLowerCase();
}

/** `SOURCE_COMMIT`: 40 hexadecimal characters, or nothing (unset, empty, blank or `unknown`), which is `null`. */
export const sourceCommitField = z.string().transform(commitOrNull).pipe(commitSchema.nullable());
