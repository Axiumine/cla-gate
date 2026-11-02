// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { sourceFiles } from '../code-caps/files.ts';
import { ROOT, repoText } from './test-support.ts';

// E20-S01: the only allowed suppression of a Semgrep finding is an inline comment that names the rule and gives a reason:
//   // <word>: <rule-id> -- <reason>
// either on its own line directly above the flagged line, or after the code on that line. The word is built from two
// halves below so that this file holds no suppression of its own.

const WORD = ['nosem', 'grep'].join('');
const PREFIX = `// ${WORD}: `;
const SEGMENT = /^[\w-]+$/;

/** `// <word>: <namespace>.<rule>... -- <reason of 10 characters or more>`, and nothing else. */
function wellFormed(comment: string): boolean {
  const split = comment.indexOf(' -- ');
  if (!comment.startsWith(PREFIX) || split < 0) {
    return false;
  }
  const segments = comment.slice(PREFIX.length, split).split('.');
  return (
    segments.length > 1 &&
    segments.every((segment) => SEGMENT.test(segment)) &&
    comment.slice(split + 4).trim().length >= 10
  );
}

/** What is wrong with the suppressions in `text`, one `line: problem` entry each. */
function problems(text: string): string[] {
  const lines = text.split('\n');
  return lines.flatMap((line, index) => {
    if (!line.includes(WORD)) {
      return [];
    }
    const comment = line.slice(Math.max(0, line.indexOf('//'))).trim();
    const own = line.trim().startsWith('//');
    const next = (lines.at(index + 1) ?? '').trim();
    const found: string[] = [];
    if (!line.includes('//') || !wellFormed(comment)) {
      found.push(
        `${index + 1}: use "// ${WORD}: <rule-id> -- <reason>" (one full rule id, a reason of 10 characters or more)`,
      );
    } else if (own && (next === '' || next.startsWith('//'))) {
      found.push(`${index + 1}: a suppression on its own line must be directly above the flagged code line`);
    }
    return found;
  });
}

const RULE = 'ajinabraham.njsscan.dos.regex_dos.regex_dos';
const REASON = 'anchored linear regex, not a request handler';

test.each([
  ['above the flagged line', `// ${WORD}: ${RULE} -- ${REASON}\nconst a = 1;\n`],
  ['after the code on the flagged line', `const a = 1; // ${WORD}: ${RULE} -- ${REASON}\n`],
  ['no suppression at all', 'const a = 1;\n'],
])('a suppression %s is accepted', (_label, text) => {
  expect(problems(text)).toEqual([]);
});

test.each([
  ['no rule id and no reason', `// ${WORD}\nconst a = 1;\n`],
  ['no reason', `// ${WORD}: ${RULE}\nconst a = 1;\n`],
  ['a reason that says nothing', `// ${WORD}: ${RULE} -- ok\nconst a = 1;\n`],
  ['a rule id without its namespace', `// ${WORD}: regex_dos -- ${REASON}\nconst a = 1;\n`],
  ['two rule ids', `// ${WORD}: ${RULE}, other.rule.id -- ${REASON}\nconst a = 1;\n`],
  ['a hash comment', `# ${WORD}: ${RULE} -- ${REASON}\nconst a = 1;\n`],
  ['a block comment', `/* ${WORD}: ${RULE} -- ${REASON} */\nconst a = 1;\n`],
  ['a suppression inside a string', `const a = '${WORD}';\n`],
])('a suppression with %s is refused', (_label, text) => {
  expect(problems(text)).toHaveLength(1);
});

test.each([
  ['a blank line', `// ${WORD}: ${RULE} -- ${REASON}\n\nconst a = 1;\n`],
  ['another comment', `// ${WORD}: ${RULE} -- ${REASON}\n// more\nconst a = 1;\n`],
  ['the end of the file', `// ${WORD}: ${RULE} -- ${REASON}`],
])('a suppression on its own line that is followed by %s is refused: it flags nothing', (_label, text) => {
  expect(problems(text)).toEqual(['1: a suppression on its own line must be directly above the flagged code line']);
});

test('the problems are numbered by line', () => {
  expect(problems(`const a = 1;\n\n// ${WORD}\nconst b = 2;\n`)).toEqual([
    `3: use "// ${WORD}: <rule-id> -- <reason>" (one full rule id, a reason of 10 characters or more)`,
  ]);
});

// A Stryker sandbox (E20-S05) is a copy of the work tree inside the git-ignored .stryker-tmp directory, where git lists no
// file, so the repository-wide scan has nothing to read there. It runs for real in the test and coverage jobs.
const inMutationSandbox = ROOT.split(path.sep).includes('.stryker-tmp');

test.skipIf(inMutationSandbox)('every suppression in this repository names its rule and gives a reason', () => {
  const files = sourceFiles(ROOT);
  expect(files.length).toBeGreaterThan(100);
  const bad = files.flatMap((file) => problems(repoText(file)).map((problem) => `${file}:${problem}`));
  expect(bad).toEqual([]);
});
