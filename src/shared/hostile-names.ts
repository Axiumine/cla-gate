// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// The single hostile-name corpus (E09-S01 defines it; E17-S06 is the first to import it, from the web test helper
// `expectHostileNamesInert`). Every test that feeds names to something that shows them later (a Check Run, a comment, a
// page) imports these lists instead of writing its own. Both are `@internal`: only tests import them, so Knip's production
// run must not report them as unused.

/** Invisible characters, built from their code points on purpose: written out they would be invisible in this file too. */
const ZWSP = String.fromCodePoint(0x200b);
const ZWJ = String.fromCodePoint(0x200d);
/** U+202E, the right-to-left override that makes `exe.live` read as `evil.exe`. */
const RLO = String.fromCodePoint(0x202e);
/** U+2028, the line separator. */
const LS = String.fromCodePoint(0x2028);

/**
 * The printable names a person can type into GitHub that are hostile to whatever shows them later: spreadsheet formulas,
 * Markdown and HTML, mentions and issue links, SQL, comment markers, bidirectional text and invisible characters. The signing
 * form accepts each of them verbatim.
 *
 * @internal
 */
export const HOSTILE_NAMES: readonly string[] = Object.freeze([
  '=HYPERLINK("http://evil.example","x")',
  '+1+1',
  '-2+3',
  '@SUM(A1)',
  "=cmd|' /C calc'!A0",
  '[x](http://evil.example)',
  '<img src=x onerror=alert(1)>',
  '@everyone',
  '@here',
  '@org/team',
  '#1',
  'org/repo#1',
  'GH-1',
  "'; drop table users;--",
  '![i](http://t.example/p.png)',
  '<script>alert(1)</script>',
  '<!-- cla-platform:license/cla:v1 -->',
  '` `` ``` ````',
  'a | b',
  '&#64;octocat',
  'trailing backslash\\',
  '/recheck',
  'javascript:alert(1)',
  'مرحبا بالعالم',
  `\u{1f469}${ZWJ}\u{1f469}${ZWJ}\u{1f467}${ZWJ}\u{1f466}`,
  `zero${ZWSP}width${ZWJ}joiner`,
  'n'.repeat(200),
]);

/**
 * What signing rejects but data that comes from GitHub could still carry: line breaks that fake Markdown structure, a NUL,
 * a lone surrogate, a right-to-left override, a line separator and a name of ten thousand characters.
 *
 * @internal
 */
export const HOSTILE_CONTROL_NAMES: readonly string[] = Object.freeze([
  '\n- [x] Signed',
  '\r\n## Passed',
  '\u0000',
  '\uD800',
  `exe.${RLO}live`,
  `line${LS}separator`,
  'x'.repeat(10_000),
]);
