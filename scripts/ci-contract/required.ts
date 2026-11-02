// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// E20-S09: the jobs that CLAUDE.md names as required status checks. The contract test fails when one of them is missing from
// ci.yml, renamed, or made conditional, because GitHub then waits forever for a check that never reports.

/** The list marker, the indentation and the bold opener in front of the bullet's text. */
const LEAD = /^[\s*-]+/;
/**
 * The bullet that lists the required checks: the word "status" is optional and the colon may sit inside the bold span, so a
 * rewrite of the wording keeps working. The captured sentence ends at the first opening parenthesis, which starts the remark
 * about strictness, so a job named in that remark does not count as required.
 */
const REQUIRED_LINE = /^Required (?:status )?checks\*{0,2}:(?<sentence>[^(]*)/;
const CODE_SPAN = /`([^`]+)`/g;

/** The names between backticks in the sentence of the "Required status checks" bullet, in order and without repeats. */
export function requiredJobNames(document: string): string[] {
  const names = document
    .split('\n')
    .flatMap((line) => {
      const sentence = REQUIRED_LINE.exec(line.replace(LEAD, ''))?.groups?.['sentence'];
      return sentence === undefined ? [] : [...sentence.matchAll(CODE_SPAN)];
    })
    .map((match) => String(match[1]));
  return [...new Set(names)];
}
