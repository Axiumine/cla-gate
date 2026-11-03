// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { commitSchema, DEFAULT_SOURCE_URL, sourceCodeUrl, sourceUrlSchema } from '../../shared/meta.ts';

// The source link of the footer (E17-S09, AGPL section 13): where the corresponding source of the running version is.

/** What the footer shows: the address of the link and, when it is known, the commit it points at. */
export interface SourceLink {
  readonly href: string;
  /** The full commit id, or `null` when the instance does not know its commit. */
  readonly commit: string | null;
}

/** What `/api/meta` says of the source, as the cache holds it. */
export interface SourceFacts {
  readonly sourceUrl: string;
  readonly commit: string | null;
}

/** The repository itself: what the footer links to before `/api/meta` has answered, and when it cannot be used. */
const FALLBACK: SourceLink = { href: DEFAULT_SOURCE_URL, commit: null };

/**
 * The link of the footer for what `/api/meta` said, or for nothing. The source address is checked again here with the same
 * schema as the server's (https, no credentials, no query or fragment) before it becomes an `href`, so a `javascript:` or
 * `http:` value, whatever put it there, is not used and the compiled-in repository address is. A commit that is not a full
 * commit id is left out and the link points at the repository.
 */
export function sourceLinkOf(facts: SourceFacts | undefined): SourceLink {
  if (facts === undefined) {
    return FALLBACK;
  }
  const url = sourceUrlSchema.safeParse(facts.sourceUrl);
  if (!url.success) {
    return FALLBACK;
  }
  const commit = commitSchema.safeParse(facts.commit);
  const known = commit.success ? commit.data : null;
  return { href: sourceCodeUrl(url.data, known), commit: known };
}
