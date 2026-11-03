// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { createHash } from 'node:crypto';
import { canonicalise, validateClaText } from '../../shared/cla-text.ts';
import { ClaRuleError } from './cla-rule-error.ts';

// What the server does with the text of a CLA before it stores it (E12-S02): it makes the text canonical, checks it and
// hashes it, in this one place. The drafts (E12-S03) and the versions (E12-S04) call `prepareClaText` and store what it
// returns; nothing else computes a hash of a CLA text.

/**
 * The SHA-256 of the UTF-8 bytes of `canonicalText`, as 64 lower-case hex digits. It equals the database check on
 * `cla_versions`, `content_sha256 = encode(sha256(convert_to(content_md, 'UTF8')), 'hex')`, for any text that
 * `validateClaText` accepts: a lone surrogate, which has no UTF-8 form, is the one string for which the two could differ.
 */
export function sha256Hex(canonicalText: string): string {
  return createHash('sha256').update(canonicalText, 'utf8').digest('hex');
}

/** A text ready to store: its canonical form and the hash of that form. */
export interface PreparedClaText {
  readonly contentMd: string;
  readonly contentSha256: string;
}

/**
 * Makes `raw` canonical, validates it and hashes it. The hash is over the canonical text, so the same wording with LF, CRLF
 * or CR line endings, or with a byte order mark, or with more than one final newline, has one hash.
 * @throws ClaRuleError `content_too_large` (with `limitBytes` and `actualBytes`), `content_empty` or
 * `content_invalid_characters`. Neither the error nor its details hold any of the text.
 */
export function prepareClaText(raw: string): PreparedClaText {
  const contentMd = canonicalise(raw);
  const problem = validateClaText(contentMd);
  if (problem !== null) {
    throw new ClaRuleError(problem.rule, 'details' in problem ? problem.details : undefined);
  }
  return { contentMd, contentSha256: sha256Hex(contentMd) };
}
