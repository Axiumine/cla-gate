// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { HOSTILE_CONTROL_NAMES, HOSTILE_NAMES } from '../../../shared/hostile-names.ts';
import { renderCheckOutput } from './check-output.ts';
import type { DisplayNames } from './display-names.ts';
import type {
  FailureRequest,
  ReportedEvaluation,
  ReportedFinding,
  ReportedRole,
  ReportedUnlinkedRole,
} from './failure-input.ts';
import { failureReport } from './failure-report.ts';

// Helpers for the tests of src/server/domain/reporting: the shared hostile corpus in the shape `test.each` wants, and the
// checks every rendered name must pass. They read the output as text and know nothing of the encoder, so a test that uses
// them cannot pass because the encoder and the check share a mistake.

/** U+200B, the zero-width space the encoder puts after an `@` or a `#`. */
export const ZWSP = String.fromCodePoint(0x200b);

/** Both frozen hostile lists (`src/shared/hostile-names.ts`) as `[label, name]` rows: the label is cut short for the title. */
export const HOSTILE_ROWS: readonly (readonly [label: string, name: string])[] = [
  ...HOSTILE_NAMES,
  ...HOSTILE_CONTROL_NAMES,
].map((name) => [JSON.stringify(name).slice(0, 40), name] as const);

/** The code point ranges that must not reach the output, written as numbers: C0, DEL and C1, the separators and the bidi controls. */
const UNSAFE_RANGES: readonly (readonly [first: number, last: number])[] = [
  [0x0, 0x1f],
  [0x7f, 0x9f],
  [0x2028, 0x2029],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
];

/** The number of Unicode code points in `text`. */
export function codePointCount(text: string): number {
  return Array.from(text).length;
}

/** True when `text` holds no line break of any kind (LF, CR, NEL, line and paragraph separator). */
export function isOneLine(text: string): boolean {
  return !/[\n\r\u0085\p{Zl}\p{Zp}]/u.test(text);
}

/** True when `text` holds a control, a line or paragraph separator or a bidirectional control: nothing GitHub should be sent. */
export function hasUnsafeCharacter(text: string): boolean {
  return Array.from(text).some((character) => {
    // The first UTF-16 unit is the whole code point below U+10000, and a surrogate (in no range) above it.
    const code = character.charCodeAt(0);
    return UNSAFE_RANGES.some(([first, last]) => code >= first && code <= last);
  });
}

/** The `@` and `#` in `text` that are not followed by U+200B: each one could still mention someone or link an issue. */
export function unguardedMarks(text: string): string[] {
  return Array.from(text.matchAll(/[@#](?!\u{200b})/gu), (match) => match[0]);
}

/** The length of the longest run of backticks in `text`. */
export function longestBackticks(text: string): number {
  return Math.max(0, ...Array.from(text.matchAll(/`+/gu), (match) => match[0].length));
}

/** True when `rendered` is exactly one inline code span: one fence at each end that no backtick run inside reaches. */
export function isOneCodeSpan(rendered: string): boolean {
  const fence = rendered.length - rendered.replace(/^`+/u, '').length;
  const inner = rendered.slice(fence, rendered.length - fence);
  return fence > 0 && rendered.endsWith('`'.repeat(fence)) && !inner.endsWith('`') && longestBackticks(inner) < fence;
}

/** `text` with each U+200B written as `⟦ZWSP⟧`, so a snapshot file shows where the encoder broke a mention. */
export function showZeroWidth(text: string): string {
  return text.replaceAll(ZWSP, '⟦ZWSP⟧');
}

/** `text` with every Markdown code span cut out: a run of n backticks opens a span that the next run of exactly n closes. */
export function outsideCodeSpans(text: string): string {
  const runs = Array.from(text.matchAll(/`+/gu));
  let kept = '';
  let at = 0;
  for (const [index, open] of runs.entries()) {
    if (open.index < at) {
      continue;
    }
    const close = runs.slice(index + 1).find((run) => run[0].length === open[0].length);
    if (close === undefined) {
      continue;
    }
    kept += text.slice(at, open.index);
    at = close.index + close[0].length;
  }
  return kept + text.slice(at);
}

// Builders for the tests of the failure report (E09-S03). They are plain data with defaults, so a test names only what it is
// about.

/** A full commit SHA that starts with a number: `sha(5)` is `0000005` and 33 zeros, so its short form tells commits apart. */
export function sha(n: number): string {
  return n.toString(16).padStart(7, '0').padEnd(40, '0');
}

/** The head SHA of the reports under test. */
export const HEAD = '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b';

type ReportedActor = ReportedEvaluation['actors'][number];

/** An actor of an evaluation: not covered, and the author of a commit, unless the test says otherwise. */
export function actor(id: number, roles: readonly ReportedRole[] = ['author'], covered = false): ReportedActor {
  return { account: { id }, roles, covered };
}

/** An unlinked identity of commit `sha(n)`, not waived by an override unless `overrideId` says so. */
export function finding(
  n: number,
  name: string,
  role: ReportedUnlinkedRole = 'author',
  overrideId: number | null = null,
): ReportedFinding {
  return { sha: sha(n), role, raw: { name }, overrideId };
}

/** A failed evaluation with nothing in it: the unsigned-contributor code, no actor, no finding, no advisory, no fix. */
export function evaluationOf(parts: Partial<ReportedEvaluation> = {}): ReportedEvaluation {
  return { failureCodes: ['unsigned_contributor'], actors: [], findings: [], advisories: [], fixes: [], ...parts };
}

/** No login and no trailer name known. */
export const NO_NAMES: DisplayNames = { logins: new Map(), coAuthors: new Map() };

/** A request for repository 4242, pull request 7 and the origin `https://cla.example.test`. */
export function requestOf(parts: Partial<FailureRequest> = {}): FailureRequest {
  return {
    headSha: HEAD,
    evaluation: evaluationOf(),
    names: NO_NAMES,
    githubRepoId: 4242,
    prNumber: 7,
    publicBaseUrl: 'https://cla.example.test',
    ...parts,
  };
}

/** A request that puts `name` in every slot: one unsigned login, one unlinked author, one unlinked committer, one co-author. */
export function everySlot(name: string): FailureRequest {
  return requestOf({
    evaluation: evaluationOf({
      actors: [actor(1, ['opener', 'author'])],
      findings: [finding(2, name, 'author'), finding(2, name, 'committer')],
      advisories: [{ code: 'co_author_unresolved', sha: sha(3) }],
    }),
    names: { logins: new Map([[1, name]]), coAuthors: new Map([[sha(3), [name]]]) },
  });
}

/** Both lists in every slot at once: 34 unsigned people, 34 unlinked commits, and the co-authors of one commit. */
export function allNames(): FailureRequest {
  const names = [...HOSTILE_NAMES, ...HOSTILE_CONTROL_NAMES];
  return requestOf({
    evaluation: evaluationOf({
      actors: names.map((_name, index) => actor(index + 1, ['opener', 'author'])),
      findings: names.map((name, index) => finding(index + 1, name, index % 2 === 0 ? 'author' : 'committer')),
      advisories: [{ code: 'co_author_unresolved', sha: sha(900) }],
    }),
    names: { logins: new Map(names.map((name, index) => [index + 1, name])), coAuthors: new Map([[sha(900), names]]) },
  });
}

/** The summary of the Check Run for a request: the report, rendered the way the writer sends it. */
export function summaryOf(request: FailureRequest): string {
  return renderCheckOutput(failureReport(request).view).summary;
}
