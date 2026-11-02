// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/**
 * The rules for `.trivyignore` (E20-S02). The file does not exist until the first ignore is needed. Every entry then has
 * a comment line directly above it that says why, and carries `exp:YYYY-MM-DD`, at most 90 days after the day it was
 * committed, so an ignore is a dated, reviewed decision and never a permanent hole.
 */

/** Longest life of an entry, counted from the day its line was committed. */
export const MAX_IGNORE_DAYS = 90;

const MS_PER_DAY = 86_400_000;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const EXPIRY_PREFIX = 'exp:';

/** The day number (days since 1970-01-01, UTC) of a `YYYY-MM-DD` text; undefined when it is not a real calendar day. */
export function dayNumber(text: string): number | undefined {
  const match = DATE.exec(text);
  if (match === null) {
    return undefined;
  }
  const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Date(time).toISOString().startsWith(text) ? time / MS_PER_DAY : undefined;
}

/** The day number (UTC) a moment falls on. */
export function dayOf(moment: Date): number {
  return Math.floor(moment.getTime() / MS_PER_DAY);
}

/** Whether the line above an entry is a comment with a reason in it. */
function hasReason(previous: string | undefined): boolean {
  return previous?.startsWith('#') === true && previous.slice(1).trim() !== '';
}

/** What is wrong with the expiry token(s) of one entry, as a message, or undefined when it is fine. */
function expiryProblem(tokens: readonly string[], committed: number, today: number): string | undefined {
  const [expiry, ...more] = tokens.filter((token) => token.startsWith(EXPIRY_PREFIX));
  const others = tokens.filter((token) => !token.startsWith(EXPIRY_PREFIX));
  if (others.length > 0) {
    return `unexpected text after the id: ${others.join(' ')}`;
  }
  if (expiry === undefined) {
    return 'no expiry (add exp:YYYY-MM-DD)';
  }
  if (more.length > 0) {
    return 'more than one expiry';
  }
  const day = dayNumber(expiry.slice(EXPIRY_PREFIX.length));
  if (day === undefined) {
    return `the expiry is not a calendar day written YYYY-MM-DD: ${expiry}`;
  }
  if (day <= today) {
    return `expired (${expiry}): Trivy stops honouring an entry on its expiry day, remove it or fix the cause`;
  }
  if (day - committed > MAX_IGNORE_DAYS) {
    return `expires more than ${MAX_IGNORE_DAYS} days after the day it was committed (${expiry})`;
  }
  return undefined;
}

/**
 * Violations of the `.trivyignore` rules in `text`, one message per problem as `.trivyignore:<line>: <problem>`.
 * `committedOn(line)` is the moment a line was committed, `today` the current moment. An empty or comment-only file is
 * valid.
 */
export function checkTrivyIgnore(text: string, committedOn: (line: number) => Date, today: Date): string[] {
  const lines = text.split('\n').map((line) => line.trim());
  return lines.flatMap((line, index) => {
    if (line === '' || line.startsWith('#')) {
      return [];
    }
    const [id = '', ...tokens] = line.split(/\s+/);
    const problems = [
      ID.test(id) ? undefined : `${id} is not an identifier (a CVE, an AVD or a secret rule id)`,
      hasReason(lines[index - 1]) ? undefined : 'no reason: put a comment line directly above the entry',
      expiryProblem(tokens, dayOf(committedOn(index + 1)), dayOf(today)),
    ];
    return problems.flatMap((problem) => (problem === undefined ? [] : [`.trivyignore:${index + 1}: ${problem}`]));
  });
}
