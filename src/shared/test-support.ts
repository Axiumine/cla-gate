// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import type { Nodes } from 'hast';
import { AUDIT_METADATA_KEYS } from './audit.ts';
import type { PrEvaluationDetails } from './pr-evaluation-details.ts';

/**
 * A stored evaluation that uses every field: both covering bases, an actor with several roles, an uncovered co-author,
 * an overridden and a plain unlinked finding, and an advisory. Ids and SHAs are made up. A fresh object on every call, so
 * a test can change it freely.
 */
export function storedDetailsSample(): PrEvaluationDetails {
  return {
    version: 1,
    outcome: 'failure',
    failureCodes: ['unlinked_identity', 'unsigned_contributor'],
    documentId: 12,
    activeMajor: 2,
    commitCount: 3,
    mergeCommitsSkipped: 1,
    listing: 'complete',
    actors: [
      {
        githubId: 1001,
        roles: ['opener', 'author'],
        covered: true,
        basis: { kind: 'signature', signatureId: 31, versionId: 7, major: 2 },
      },
      {
        githubId: 1002,
        roles: ['committer'],
        covered: true,
        basis: { kind: 'allowlist', entryId: 4, entryKind: 'org_members', scope: 'installation' },
      },
      { githubId: 1003, roles: ['co_author'], covered: false, basis: null },
    ],
    unlinked: [
      { sha: 'a'.repeat(40), role: 'author', overrideId: null },
      { sha: 'b'.repeat(64), role: 'committer', overrideId: 55 },
    ],
    advisories: [{ code: 'co_author_unresolved', sha: 'c'.repeat(40) }],
  };
}

/** `[name, metadata, accepted]`: one table that both the zod schema and the database check must agree with (E04-S09). */
export type MetadataCase = readonly [name: string, metadata: unknown, accepted: boolean];

const codeOf = (length: number): string => 'a'.repeat(length);

export const METADATA_CASES: readonly MetadataCase[] = [
  ['nothing at all', {}, true],
  ['an integer', { count: 3 }, true],
  ['zero and a negative integer', { count: 0, minor: -1 }, true],
  ['booleans and null', { enabled: false, pr_number: null }, true],
  ['a code with digits and punctuation', { state: 'a.b:c-d_e9' }, true],
  ['a code that starts with a digit', { scope: '7up' }, true],
  ['a commit SHA', { commit_sha: 'f'.repeat(40) }, true],
  ['a SHA-256 digest', { commit_sha: '0'.repeat(64) }, true],
  ['a code of 64 characters', { kind: codeOf(64) }, true],
  ['a dotted version with three numbers', { revision: '1.2.3' }, true],
  ['a dotted name that is not four numbers', { kind: 'a.b.c.d' }, true],
  ['four numbers of which one has four digits', { kind: '1234.5.6.7' }, true],
  ['five numbers with dots', { kind: '1.2.3.4.5' }, true],
  ['a code with one colon', { scope: 'org:member' }, true],
  // Mutation testing (E20-S04): each of these tells apart an address check from the same check with one anchor or one
  // digit-count dropped. The database check (migration 002) judges them the same way.
  ['hex digits around a single colon, which is no IPv6 address', { scope: 'dead:beef' }, true],
  ['an IPv4 address with a port and trailing text', { scope: '1.2.3.4:5x' }, true],
  ['an IPv4 address with a port and leading text', { scope: 'x1.2.3.4:5' }, true],
  ['two colons after text, which is no IPv6 address', { state: 'xyz:a:b' }, true],
  ['two colons before text, which is no IPv6 address', { state: 'a:b:xyz' }, true],
  ['a list of integers', { rows: [1, 2, 3] }, true],
  ['an empty list', { rows: [] }, true],
  ['a list of 100 integers', { rows: Array.from({ length: 100 }, (_, index) => index) }, true],
  ['every key of the closed list', Object.fromEntries(AUDIT_METADATA_KEYS.map((key) => [key, 1])), true],
  ['a fraction', { count: 1.5 }, false],
  ['an empty code', { kind: '' }, false],
  ['a code of 65 characters', { kind: codeOf(65) }, false],
  ['a code in upper case', { kind: 'Individual' }, false],
  ['a code with a space', { kind: 'two words' }, false],
  ['an e-mail address in a code', { reason_code: 'alice@example.com' }, false],
  ['an IPv4 address', { kind: '203.0.113.7' }, false],
  ['an IPv4 address under another key', { state: '198.51.100.9' }, false],
  ['an IPv4 address with a port', { scope: '203.0.113.7:8080' }, false],
  ['an IPv4 address whose last number has three digits', { kind: '203.0.113.255' }, false],
  ['an IPv4 address of three-digit numbers with a five-digit port', { scope: '203.113.113.255:65535' }, false],
  ['an IPv6 address', { kind: '2001:db8::1' }, false],
  ['an IPv6 address with a group after the gap', { state: '2001:db8:0:1::5' }, false],
  ['the IPv6 loopback address', { kind: '::1' }, false],
  ['an IPv6 address written in full', { scope: '2001:db8:0:0:0:0:0:1' }, false],
  ['an IPv6 address that ends in an IPv4 address', { reason_code: '2001:db8::203.0.113.7' }, false],
  ['a code with a trailing newline', { kind: 'individual\n' }, false],
  ['a code with a letter outside ASCII', { kind: 'café' }, false],
  ['a list of 101 integers', { rows: Array.from({ length: 101 }, (_, index) => index) }, false],
  ['a list of strings', { rows: ['a'] }, false],
  ['a list holding null', { rows: [null] }, false],
  ['a list holding a fraction', { rows: [1.5] }, false],
  ['a nested list', { rows: [[1]] }, false],
  ['an object as a value', { count: { n: 1 } }, false],
  ['a name', { name: 'Alice' }, false],
  ['an e-mail address as a key', { email: 'alice@example.com' }, false],
  ['a login', { login: 'alice' }, false],
  ['an avatar URL', { avatar_url: 'https://avatars.example/u' }, false],
  ['free text under reason', { reason: 'because' }, false],
  ['free text under message', { message: 'hello' }, false],
  ['free text under title', { title: 'hello' }, false],
  ['free text under text', { text: 'hello' }, false],
  ['a key that is not listed', { foo: 1 }, false],
  ['a listed key in capitals', { Count: 1 }, false],
  ['a key that merely contains a listed one', { source_count: 1 }, false],
  ['a key that merely starts with a personal word', { username: 'alice' }, false],
  ['a list instead of an object', [], false],
  ['null instead of an object', null, false],
  ['a string instead of an object', 'count', false],
];

/** Every node of a hast tree, the root first, in document order. The walk is iterative, so a deep tree cannot overflow the stack. */
export function hastNodes(tree: Nodes): Nodes[] {
  const found: Nodes[] = [];
  const pending: Nodes[] = [tree];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    found.push(node);
    if ('children' in node) {
      pending.push(...node.children.toReversed());
    }
  }
  return found;
}

/** The text of a hast tree: the text nodes in document order, joined. */
export function hastText(tree: Nodes): string {
  return hastNodes(tree)
    .map((node) => (node.type === 'text' ? node.value : ''))
    .join('');
}

/** `depth` block quotes one inside the other, around the word `x`: `> > x` for 2. */
export function nestedQuotes(depth: number): string {
  return `${'> '.repeat(depth)}x\n`;
}

/** `depth` bullet lists one inside the other, each opened on the same line: `- - x` for 2. */
export function nestedBullets(depth: number): string {
  return `${'- '.repeat(depth)}x\n`;
}

/** `depth` lists nested by indentation, one item to a line, two more spaces for each level. */
export function indentedBullets(depth: number): string {
  const items = Array.from({ length: depth }, (_unused, level) => `${'  '.repeat(level)}- item ${level + 1}`);
  return `${items.join('\n')}\n`;
}

/** Emphasis and strong text `depth` deep, one inside the other, around the word `x`. */
export function nestedEmphasis(depth: number): string {
  let text = 'x';
  for (let level = 0; level < depth; level += 1) {
    text = level % 2 === 0 ? `*a ${text} a*` : `__a ${text} a__`;
  }
  return `${text}\n`;
}

/** A small seeded generator of numbers in [0, 1) (mulberry32): the same seed gives the same texts on every machine. */
function seededUnit(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const MARKER_PIECES = ['> ', '> ', '>', '- ', '* ', '+ ', '1. ', '2. ', '10) ', '-', '1.'];
const INDENT_PIECES = ['', '', '', '  ', '   ', '    ', '      '];
const BODY_PIECES = [
  'text',
  'more text',
  '',
  '',
  '# heading',
  '---',
  '===',
  '* * *',
  '```',
  '~~~',
  'text  ',
  'a *b* c',
];

/**
 * `count` short Markdown texts of up to ten lines, made of the pieces that build block structure: indentation of 0 to 6 spaces,
 * up to three container markers (`>`, bullets, numbers) and a body (text, a blank, a heading, a rule, an underline, a fence).
 * Most are nonsense, which is the point: they put the rules of CommonMark about containers to work in many orders.
 */
export function generatedMarkdown(seed: number, count: number): string[] {
  const unit = seededUnit(seed);
  const pick = (pieces: readonly string[]): string => {
    const index = Math.floor(unit() * pieces.length);
    return pieces.slice(index, index + 1).join('');
  };
  return Array.from({ length: count }, () => {
    const lines = Array.from({ length: 1 + Math.floor(unit() * 10) }, () => {
      const markers = Array.from({ length: Math.floor(unit() * 4) }, () => pick(MARKER_PIECES));
      return `${pick(INDENT_PIECES)}${markers.join('')}${pick(BODY_PIECES)}`;
    });
    return `${lines.join('\n')}\n`;
  });
}

/** Runs of container markers on one line (a quote, two bullets, a number with a dot), each as long as the number of bytes it is given. */
export const MARKER_RUNS: readonly (readonly [label: string, build: (bytes: number) => string])[] = [
  ['quotes', (bytes) => '> '.repeat(Math.floor(bytes / 2))],
  ['bullets', (bytes) => '+ * '.repeat(Math.floor(bytes / 4))],
  ['numbers', (bytes) => '1. '.repeat(Math.floor(bytes / 3))],
];

/** A clock in milliseconds from any starting point: `performance.now` in a test of the code, a counter in the test of `slowdownOf`. */
export type Clock = () => number;

/**
 * The size of the large text of the linear-time tests, 64 KiB (the small ones are a sixteenth of it, 4 KiB). Large enough that a
 * scan that reads every line again for every line is sixteen times slower on it (by seconds), small enough that the measure
 * stays under the test timeout in the sandbox of the mutation gate, where a pass over 200 KiB took 3 seconds on the slow runner.
 */
export const TIMED_BYTES = 65_536;

/** How many times larger the large text of `slowdownOf` is than each of the small ones, which are as many as that. */
export const SIZE_RATIO = 16;

/**
 * The slowdown that still counts as linear time. `slowdownOf` is 1 for a scan that reads each byte a fixed number of times and
 * `SIZE_RATIO` (16) for one that reads every line again for every line. Measured for the scan of the CLA text on a machine at a
 * load average of 140 on 32 cores, at its worst for this test: 0.5 to 2.2 for linear scans. The limit, 6, is nearly three times
 * that and nearly three times under a quadratic scan. A fixed factor of slowness, the same on both sides, does not show here;
 * the tests of the same texts check what the code returns.
 */
export const MOST_LINEAR_SLOWDOWN = 6;

/** Timed runs of each side at most: the fastest of them is kept, so a pause of the process (the garbage collector, other work on the machine) in one run costs nothing. */
const TIMED_RUNS = 7;

/**
 * Timed runs of each side at least. After this many, a ratio under the limit ends the measurement: in the sandbox of the mutation
 * gate every executed line of the code under test also records which test ran it, a pass over 200 KiB takes seconds there, and
 * the seven runs of the measure took the whole test timeout of 30 s (the dry run of the `shared` shard, 2026-11-05). Two runs
 * keep the protection against one pause: a quadratic scan, 16 here, reads under the limit of 6 only when the small texts were
 * slowed by a factor of 2.7 in both runs and the large one in neither.
 */
const LEAST_RUNS = 2;

/** The least time, in milliseconds, that is taken as measured: a run below it (a scan that stops on the first line) is within the noise of the clock and would make the ratio of two noises. */
const CLOCK_FLOOR_MS = 0.05;

/** The milliseconds `task` takes. */
function timeOf(task: () => void, now: Clock): number {
  const started = now();
  task();
  return now() - started;
}

/**
 * How many times longer one pass of `work` over a text of `bytes` bytes takes than `SIZE_RATIO` passes over a text of
 * `bytes / SIZE_RATIO` bytes, both made by `build`: the same amount of text on both sides. 1 is linear time, `SIZE_RATIO`
 * quadratic; compare it with `MOST_LINEAR_SLOWDOWN`. A test that asserts a bound in seconds fails on a slow or busy machine and
 * proves nothing on a fast one, and the ratio of two single runs of different lengths is biased by the load: the scheduler cuts a
 * long run more often than a short one, and the fastest of several short runs is nearly free of it (a run of the large text over
 * the run of one small text read 80 where linear is 16, at a load average of 140). Two sides that last about as long are cut
 * alike, so the ratio holds on a busy machine. Each side is timed one after the other and the fastest of each is compared: at
 * least `LEAST_RUNS` times, and up to `TIMED_RUNS` times while the ratio is not under `MOST_LINEAR_SLOWDOWN`.
 * @param work The code under test.
 * @param build The text of the given size in bytes.
 * @param bytes The size of the large text.
 * @param now The clock; the test of this function passes a counter.
 * @returns The time of the large text divided by the time of the small texts.
 */
export function slowdownOf(
  work: (text: string) => unknown,
  build: (bytes: number) => string,
  bytes: number,
  now: Clock = () => performance.now(),
): number {
  const small = build(Math.floor(bytes / SIZE_RATIO));
  const large = build(bytes);
  let fastestSmall = Number.POSITIVE_INFINITY;
  let fastestLarge = Number.POSITIVE_INFINITY;
  let slowdown = Number.POSITIVE_INFINITY;
  for (let run = 1; run <= TIMED_RUNS && (run <= LEAST_RUNS || slowdown >= MOST_LINEAR_SLOWDOWN); run += 1) {
    const smalls = timeOf(() => {
      for (let copy = 0; copy < SIZE_RATIO; copy += 1) {
        work(small);
      }
    }, now);
    fastestSmall = Math.min(fastestSmall, smalls);
    fastestLarge = Math.min(
      fastestLarge,
      timeOf(() => work(large), now),
    );
    slowdown = fastestLarge / Math.max(fastestSmall, CLOCK_FLOOR_MS);
  }
  return slowdown;
}

/**
 * One row of the hostile CLA input table (E12-S07): what the row is, the Markdown source, and the text a signer must still read
 * in what is shown (the markup that was refused stays visible as text, because a legal text must show all of what it says).
 */
export type HostileClaRow = readonly [label: string, source: string, shown: string];

/**
 * The hostile input table of the CLA renderer (E12-S07). The sanitiser test walks the tree it gives for each row, and the
 * component that draws the tree (E18-S01, `MarkdownView`) is fed the same rows, so both are held to one table.
 */
export const HOSTILE_CLA_ROWS: readonly HostileClaRow[] = [
  ['a script element', '<script>alert(1)</script>', '<script>alert(1)</script>'],
  ['an image with an onerror handler', '<img src=x onerror=alert(1)>', '<img src=x onerror=alert(1)>'],
  ['an iframe', '<iframe src="javascript:alert(1)"></iframe>', '<iframe src="javascript:alert(1)"></iframe>'],
  ['a style element', '<style>body{display:none}</style>', '<style>body{display:none}</style>'],
  ['an HTML comment', 'before <!-- hidden --> after', 'before <!-- hidden --> after'],
  ['a javascript: link', '[x](javascript:alert(1))', 'x'],
  ['a link with a mixed-case JaVaScRiPt: scheme', '[x](JaVaScRiPt:alert(1))', 'x'],
  [
    'a scheme broken by a tab, which the parser leaves as text',
    '[x](java\tscript:alert(1))',
    '[x](java\tscript:alert(1))',
  ],
  ['a scheme broken by an entity-encoded tab', '[x](java&#9;script:alert(1))', 'x'],
  ['an entity-encoded first letter', '[x](&#106;avascript:alert(1))', 'x'],
  ['a named-entity colon', '[x](javascript&colon;alert(1))', 'x'],
  ['an entity-encoded line feed before the scheme', '[x](&#x0A;javascript:alert(1))', 'x'],
  ['a data: URL', '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)', 'x'],
  ['a data: URL with the markup in the address', '[x](data:text/html,%3Cscript%3Ealert(1)%3C/script%3E)', 'x'],
  ['a vbscript: link', '[x](vbscript:msgbox(1))', 'x'],
  ['a protocol-relative link', '[x](//evil.example)', 'x'],
  ['a relative link', '[x](/relative)', 'x'],
  ['a link to a fragment', '[x](#fragment)', 'x'],
  ['a scheme that only starts like http', '[x](http:javascript:alert(1))', 'x'],
  ['an http scheme in capitals, which is not recognised', '[x](HTTP://OK.EXAMPLE)', 'x'],
  ['a backslash after the scheme', '[x](https:\\\\evil)', 'x'],
  ['an image with no alt text', '![](http://t.example/p.png)', ''],
  ['an image with alt text', '![pixel](http://t.example/p.png)', 'pixel'],
  ['a reference-style image', '![alt][r]\n\n[r]: http://t.example/p.png', 'alt'],
  ['an image inside a safe link', '[![pixel](http://t.example/p.png)](http://ok.example)', 'pixel'],
  [
    'an svg with a style that breaks out of an attribute',
    '<svg><p><style><a title="</style><img src onerror=alert(1)>">',
    '<svg><p><style><a title="</style><img src onerror=alert(1)>">',
  ],
  ['an autolink to javascript:', '<javascript:alert(1)>', 'javascript:alert(1)'],
  ['a reference-style link to javascript:', '[x][r]\n\n[r]: javascript:alert(1)', 'x'],
  ['a raw anchor to javascript:', '<a href="javascript:x">click</a>', '<a href="javascript:x">click</a>'],
  ['a pointy destination with a title', '[x](<javascript:alert(1)> "title")', 'x'],
  ['an element with an onclick handler', '<div onclick="x()">text</div>', '<div onclick="x()">text</div>'],
  ['an entity-encoded script element', '&lt;script&gt;alert(1)&lt;/script&gt;', '<script>alert(1)</script>'],
  ['a title that tries to be an attribute', '[x](http://ok.example "onmouseover=alert(1)")', 'x'],
  ['a quote that tries to end the href', '[x](http://ok.example/"onmouseover="alert(1))', 'x'],
  ['a fenced block of HTML', '```html\n<script>alert(1)</script>\n```', '<script>alert(1)</script>\n'],
  ['an indented block of HTML', '    <script>alert(1)</script>', '<script>alert(1)</script>\n'],
  ['a code span of HTML', '`<script>`', '<script>'],
  ['a heading with an onerror image', '# <img src=x onerror=alert(1)>', '<img src=x onerror=alert(1)>'],
  [
    'object, embed, form and input',
    '<object data="javascript:alert(1)"></object><embed src=x><form action=x><input onfocus=alert(1)>',
    '<object data="javascript:alert(1)"></object><embed src=x><form action=x><input onfocus=alert(1)>',
  ],
];
