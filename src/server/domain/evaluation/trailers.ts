// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { isIgnoredTrailerEmail, noreplyAccountId } from './trailer-identities.ts';
import type { AdvisoryCode } from './types.ts';

// E08-S06: reads the `Co-authored-by` trailers of one commit message. The text is spoofable, so the result is never
// trusted to grant anything: the only thing taken from a trailer is a numeric GitHub id in a noreply address, and that id
// becomes an actor who must be covered like anyone else. Everything else the trailer says (the name above all) is dropped
// here and never reaches a rule, a stored value or a rendered text.

/** At most this many trailers of a commit are read; a commit with more gets one `too_many_trailers` advisory. */
export const MAX_TRAILERS_PER_COMMIT = 20;

const TRAILER_KEY = 'co-authored-by:';

/** What one commit message says about its co-authors. */
export interface ParsedCoAuthors {
  /** Numeric ids of the trailers that resolved, in the order written. A repeated id is repeated. */
  readonly githubIds: readonly number[];
  /** One `co_author_unresolved` per read trailer that names someone we cannot resolve, then `too_many_trailers` last. */
  readonly advisories: readonly AdvisoryCode[];
}

type TrailerReading =
  | { readonly kind: 'resolved'; readonly githubId: number }
  | { readonly kind: 'ignored' }
  | { readonly kind: 'unresolved' };

const IGNORED: TrailerReading = { kind: 'ignored' };
const UNRESOLVED: TrailerReading = { kind: 'unresolved' };

const isBlank = (line: string): boolean => line.trim() === '';

/**
 * The lines of the final paragraph: the text after the last blank line, with CRLF read as LF. Blank lines at the very
 * end are not a paragraph of their own, so a message that ends in a newline still has its trailers. The lines are found
 * by scanning, not by one regular expression over the whole message, so a hostile run of blank lines costs nothing extra.
 */
function finalParagraph(message: string): readonly string[] {
  const lines = message.replaceAll('\r\n', '\n').split('\n');
  const last = lines.findLastIndex((line) => !isBlank(line));
  if (last < 0) {
    return [];
  }
  const blankBefore = lines.slice(0, last).findLastIndex(isBlank);
  return lines.slice(blankBefore + 1, last + 1);
}

/** The text after `Co-authored-by:` when the line is such a trailer (key in any case), else `null`. */
function trailerValue(line: string): string | null {
  return line.slice(0, TRAILER_KEY.length).toLowerCase() === TRAILER_KEY ? line.slice(TRAILER_KEY.length).trim() : null;
}

/**
 * The email of `Name <email>`: what sits between the last `<` and the closing `>` that ends the line. Whatever comes
 * before the `<` is the name; it is never read, so markdown, `@mentions`, `#12` or a bidi override in it change nothing.
 */
function emailOf(value: string): string | null {
  const open = value.lastIndexOf('<');
  return open >= 0 && value.endsWith('>') ? value.slice(open + 1, -1) : null;
}

/** Ignored first (a bot or an AI tool), then resolved from the noreply form; everything else cannot be resolved. */
function readTrailer(value: string): TrailerReading {
  const email = emailOf(value);
  if (email === null) {
    return UNRESOLVED;
  }
  if (isIgnoredTrailerEmail(email)) {
    return IGNORED;
  }
  const githubId = noreplyAccountId(email);
  return githubId === null ? UNRESOLVED : { kind: 'resolved', githubId };
}

/**
 * Reads the `Co-authored-by` trailers of a commit message. Only the final paragraph is read (text after the last blank
 * line, CRLF normalised), and a line is a trailer when it starts with `co-authored-by:` in any case. At most
 * `MAX_TRAILERS_PER_COMMIT` trailers are read; the first one beyond adds `too_many_trailers` and the rest are not read.
 * A trailer from a bot or an AI tool gives nothing. A trailer in the form `ID+login@users.noreply.github.com` gives its
 * numeric id. Any other trailer (the legacy form without id, another email, no angle brackets, an id of 0 or above the
 * safe range) gives `co_author_unresolved`: advisory only, it never blocks and carries no name or email.
 */
export function parseCoAuthors(message: string): ParsedCoAuthors {
  const githubIds: number[] = [];
  const advisories: AdvisoryCode[] = [];
  let read = 0;
  for (const line of finalParagraph(message)) {
    const value = trailerValue(line);
    if (value === null) {
      continue;
    }
    if (read === MAX_TRAILERS_PER_COMMIT) {
      advisories.push('too_many_trailers');
      break;
    }
    read += 1;
    const reading = readTrailer(value);
    if (reading.kind === 'resolved') {
      githubIds.push(reading.githubId);
    } else if (reading.kind === 'unresolved') {
      advisories.push('co_author_unresolved');
    }
  }
  return { githubIds, advisories };
}
