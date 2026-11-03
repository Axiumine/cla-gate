// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../shared/github-id.ts';
import type { Job } from './jobs.ts';

// The `/recheck` command (E07-S07): a pull request comment that asks for a new evaluation. The rule is exact on purpose. A
// loose match (a comment that merely mentions `/recheck`, quotes someone who wrote it, or shows it in a code block) would
// spend GitHub API budget on text nobody meant as a command, and a lookalike (a fullwidth solidus, a zero-width character
// inside the word) is not the command either. The webhook router prefilters with a plain substring (`webhook-routing-comments.ts`);
// the job applies this function to the comment it fetched from GitHub.

/** The only line that is the command. */
const COMMAND = '/recheck';

/** The characters a fence is made of. */
const FENCE_CHARACTERS = ['`', '~'] as const;

/** The fence that is open: the character it is made of and how many of them opened it. */
interface Fence {
  readonly character: (typeof FENCE_CHARACTERS)[number];
  readonly length: number;
}

/** The text of `line` after at most three spaces of indentation, or undefined when it is indented further (an indented code block, which opens no fence and quotes nothing). */
function afterIndent(line: string): string | undefined {
  let at = 0;
  while (line.charAt(at) === ' ') {
    at += 1;
  }
  return at <= 3 ? line.slice(at) : undefined;
}

/** How many times `text` starts with `character` in a row. */
function runOf(text: string, character: string): number {
  let length = 0;
  while (text.charAt(length) === character) {
    length += 1;
  }
  return length;
}

/** `text` without the spaces and tabs at its end. */
function withoutTrailingBlanks(text: string): string {
  let end = text.length;
  while (text.charAt(end - 1) === ' ' || text.charAt(end - 1) === '\t') {
    end -= 1;
  }
  return text.slice(0, end);
}

/**
 * The fence a line opens, or undefined: at most three spaces, then three or more backticks or tildes, then the info string. A
 * backtick fence cannot have a backtick in its info string, which makes the line an inline code span instead (CommonMark).
 */
function opening(line: string): Fence | undefined {
  const text = afterIndent(line);
  const character = FENCE_CHARACTERS.find((candidate) => text?.startsWith(candidate.repeat(3)));
  if (text === undefined || character === undefined) {
    return undefined;
  }
  const length = runOf(text, character);
  return character === '`' && text.slice(length).includes('`') ? undefined : { character, length };
}

/** Whether `line` closes `fence`: at most three spaces, the same character at least as often as it opened, then nothing but blanks. */
function closes(fence: Fence, line: string): boolean {
  const text = withoutTrailingBlanks(afterIndent(line) ?? '');
  return text.length >= fence.length && runOf(text, fence.character) === text.length;
}

/** Whether `line` is a line of a Markdown blockquote: at most three spaces of indentation, then `>`. */
function isQuoted(line: string): boolean {
  return afterIndent(line)?.startsWith('>') === true;
}

/** What reading one line did: the fence that is open after it, and whether the line is plain text (outside a fence and a quote). */
interface Step {
  readonly fence: Fence | undefined;
  readonly plain: boolean;
}

/** Reads `line` with `fence` open, or none. */
function step(fence: Fence | undefined, line: string): Step {
  if (fence !== undefined) {
    return { fence: closes(fence, line) ? undefined : fence, plain: false };
  }
  if (isQuoted(line)) {
    return { fence: undefined, plain: false };
  }
  const opened = opening(line);
  return { fence: opened, plain: opened === undefined };
}

/**
 * True when a line of `body` is exactly `/recheck`.
 * - The body is split on `\n` and one trailing `\r` is taken off each line, so a body written on Windows (`\r\n`) works and a
 *   line ending in two `\r` does not. A lone `\r`, `\u2028` or any other separator does not split a line.
 * - A line must equal `/recheck` as it stands: case sensitive, no other character, no space or tab around it, no
 *   zero-width character, no lookalike.
 * - A line inside a fenced code block (backticks or tildes, closed by the same character at least as long, or by the end of
 *   the body) does not count, and neither does a quoted line (`> ...`). A quoted line does not open a fence for the lines that follow it.
 */
export function isRecheckCommand(body: string): boolean {
  let fence: Fence | undefined;
  for (const raw of body.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const read = step(fence, line);
    if (read.plain && line === COMMAND) {
      return true;
    }
    ({ fence } = read);
  }
  return false;
}

/** Seconds in which a pull request takes one manual re-evaluation: a second request inside the window is dropped (epoch-aligned, see `EnqueueOptions`). */
export const RECHECK_WINDOW_SECONDS = 60;

/** The rate limit key of the manual re-evaluations of one pull request: every way of asking for one shares it (a `/recheck` comment, the Re-run of a check). */
export function recheckRateLimitKey(githubRepoId: GithubId, prNumber: number): string {
  return `recheck:${String(githubRepoId)}:${String(prNumber)}`;
}

/**
 * The rate limit the delivery of `job` is sent under, or `undefined` for a job with none (E07-S07). A `recheck-comment` job
 * spends GitHub calls before it knows whether the comment is the command (the repository, the comment, the pull request), and
 * anyone who can comment can post `/recheck` again and again, so the limit is on the job and not only on the evaluation it
 * may send: the second comment of a minute never becomes a job, and the delivery is marked processed without one.
 */
export function deliveryRateLimit(
  job: Job,
): { readonly dedupeKey: string; readonly dedupeWindowSeconds: number } | undefined {
  return job.type === 'recheck-comment'
    ? { dedupeKey: recheckRateLimitKey(job.githubRepoId, job.prNumber), dedupeWindowSeconds: RECHECK_WINDOW_SECONDS }
    : undefined;
}
