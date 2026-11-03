// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { isIgnoredTrailerEmail, noreplyAccountId } from './trailer-identities.ts';
import type { AdvisoryCode } from './types.ts';

// E08-S06: reads the `Co-authored-by` trailers of one commit message. The text is spoofable, so the result is never
// trusted to grant anything: the only thing taken from a trailer is a numeric GitHub id in a noreply address, and that id
// becomes an actor who must be covered like anyone else. Everything else the trailer says (the name above all) is dropped
// here and never reaches a rule or a stored value. The one exception is `unresolvedCoAuthorNames` (E09-S03), which hands
// the name of a trailer that could not be resolved to the reporter, for the advisory list of the Check Run; the reporter
// prints it only through `renderName`, and an email address is never part of it.

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

/** One trailer as read: what it resolves to, and the name written before its address (display-only, never an address). */
type ReadTrailer = TrailerReading & { readonly name: string };

/** The trailers of a message, at most `MAX_TRAILERS_PER_COMMIT` of them, and whether there were more. */
interface ReadTrailers {
  readonly trailers: readonly ReadTrailer[];
  readonly overflow: boolean;
}

/** The text before the last `<` of a trailer value, trimmed: the name. A value with no `<` gives no name, so a bare address is never one. */
function nameOf(value: string): string {
  const open = value.lastIndexOf('<');
  return open < 0 ? '' : value.slice(0, open).trim();
}

/** The `Co-authored-by` trailers of the final paragraph, in order, up to the limit; the first one beyond it sets `overflow`. */
function readTrailers(message: string): ReadTrailers {
  const trailers: ReadTrailer[] = [];
  for (const line of finalParagraph(message)) {
    const value = trailerValue(line);
    if (value === null) {
      continue;
    }
    if (trailers.length === MAX_TRAILERS_PER_COMMIT) {
      return { trailers, overflow: true };
    }
    trailers.push({ ...readTrailer(value), name: nameOf(value) });
  }
  return { trailers, overflow: false };
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
  const { trailers, overflow } = readTrailers(message);
  const githubIds = trailers.flatMap((trailer) => (trailer.kind === 'resolved' ? [trailer.githubId] : []));
  const advisories: AdvisoryCode[] = trailers.flatMap((trailer) =>
    trailer.kind === 'unresolved' ? ['co_author_unresolved' as const] : [],
  );
  return { githubIds, advisories: overflow ? [...advisories, 'too_many_trailers'] : advisories };
}

/**
 * The names of the trailers `parseCoAuthors` reports as `co_author_unresolved`, in the order written, for the reporter's
 * advisory list (E09-S03). Each one is the text before the last `<` of its trailer, trimmed, which may be empty: the address
 * is never part of it, and a trailer with no `<` gives an empty name. The names are display-only text that anyone can write;
 * they reach the output only through `renderName`. A trailer of a bot or an AI tool, a resolved one and one past the limit
 * give none, exactly as they give no advisory.
 */
export function unresolvedCoAuthorNames(message: string): readonly string[] {
  return readTrailers(message).trailers.flatMap((trailer) => (trailer.kind === 'unresolved' ? [trailer.name] : []));
}
