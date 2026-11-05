// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../shared/github-id.ts';
import {
  type ErasureOutcome,
  erasureHolds,
  exitCodeOf,
  type Footprint,
  isErased,
  rowsOf,
  signaturesOf,
} from './operator-erasure.ts';
import { dryRunLines, erasedLines, mismatchLines, partialLine } from './operator-erasure-lines.ts';

// The judgement and the wording of the operator's erasure command (E22-S05), with no database.

const id = parseGithubId(42);

/** A footprint of the person in the installations `[installation id, signatures, signer_pii rows]`. */
function footprint(scrubbed: boolean, ...installations: readonly (readonly [number, number, number])[]): Footprint {
  return {
    known: true,
    scrubbed,
    installations: installations.map(([installationId, signatures, signerPiiRows]) => ({
      installationId,
      signatures,
      signerPiiRows,
    })),
  };
}

const BEFORE = footprint(false, [7, 2, 2], [9, 1, 1]);
const ERASED = footprint(true, [7, 2, 0], [9, 1, 0]);

test('the totals add the installations up', () => {
  expect({ rows: rowsOf(BEFORE), signatures: signaturesOf(BEFORE) }).toEqual({ rows: 3, signatures: 3 });
  expect({ rows: rowsOf(footprint(false)), signatures: signaturesOf(footprint(false)) }).toEqual({
    rows: 0,
    signatures: 0,
  });
});

test.each([
  ['rows and an unscrubbed snapshot', footprint(false, [7, 2, 2]), false],
  ['rows and a scrubbed snapshot', footprint(true, [7, 2, 1]), false],
  ['no rows and an unscrubbed snapshot', footprint(false, [7, 2, 0]), false],
  ['no rows, no installation and an unscrubbed snapshot', footprint(false), false],
  ['no rows and a scrubbed snapshot', footprint(true, [7, 2, 0], [9, 1, 0]), true],
  ['no installation and a scrubbed snapshot', footprint(true), true],
])('a person with %s is erased: %s', (_label, shown, erased) => {
  expect(isErased(shown)).toBe(erased);
});

test('the check holds only for no rows anywhere, a scrubbed snapshot and the same signature cores', () => {
  expect(erasureHolds(BEFORE, ERASED)).toBe(true);
  expect(erasureHolds(BEFORE, footprint(true, [7, 2, 0], [9, 1, 1]))).toBe(false);
  expect(erasureHolds(BEFORE, footprint(false, [7, 2, 0], [9, 1, 0]))).toBe(false);
  expect(erasureHolds(BEFORE, footprint(true, [7, 1, 0], [9, 1, 0]))).toBe(false);
  expect(erasureHolds(BEFORE, footprint(true, [7, 2, 0]))).toBe(false);
  expect(erasureHolds(BEFORE, footprint(true, [7, 2, 0], [9, 1, 0], [11, 1, 0]))).toBe(false);
  expect(erasureHolds(BEFORE, footprint(true, [7, 2, 0], [10, 1, 0]))).toBe(false);
});

test('the dry run prints the totals, the counts per installation and that nothing was changed', () => {
  expect(dryRunLines(id, BEFORE)).toEqual([
    'erase dry run for GitHub id 42: 3 signer_pii rows in 2 installations, 3 signature cores would be kept, users snapshot scrubbed: no',
    'installation 7: 2 signer_pii rows, 2 signature cores',
    'installation 9: 1 signer_pii rows, 1 signature cores',
    'nothing was changed; add --execute to erase',
  ]);
});

test('the dry run says so when the snapshot is scrubbed already but rows remain', () => {
  expect(dryRunLines(id, footprint(true, [7, 1, 1]))[0]).toBe(
    'erase dry run for GitHub id 42: 1 signer_pii rows in 1 installations, 1 signature cores would be kept, users snapshot scrubbed: yes',
  );
});

test('the dry run warns that a person with no signature cannot be scrubbed, because the function needs an installation', () => {
  expect(dryRunLines(id, footprint(false))).toEqual([
    'erase dry run for GitHub id 42: 0 signer_pii rows in 0 installations, 0 signature cores would be kept, users snapshot scrubbed: no',
    'no installation holds a signature of this person, so the erasure function has no installation to run in: --execute would leave the users snapshot as it is and exit 3',
    'nothing was changed; add --execute to erase',
  ]);
});

test('a finished erasure prints the rows deleted per installation and the cores kept', () => {
  expect(
    erasedLines(id, BEFORE, [
      { installationId: 7, deleted: 2 },
      { installationId: 9, deleted: 1 },
    ]),
  ).toEqual([
    'erased GitHub id 42: 3 signer_pii rows deleted in 2 installations, 3 signature cores kept, users snapshot scrubbed',
    'installation 7: 2 signer_pii rows deleted',
    'installation 9: 1 signer_pii rows deleted',
  ]);
});

test('a failed check names the rows left per installation, the snapshot and the cores, each only when it differs', () => {
  expect(mismatchLines(id, BEFORE, footprint(false, [7, 2, 2], [9, 1, 0]))).toEqual([
    'erase failed: the check after the erasure of GitHub id 42 does not hold',
    'signer_pii rows left: 2',
    'installation 7: 2 signer_pii rows left',
    'users snapshot scrubbed: no',
  ]);
  expect(mismatchLines(id, BEFORE, footprint(true, [7, 1, 0], [9, 1, 0]))).toEqual([
    'erase failed: the check after the erasure of GitHub id 42 does not hold',
    'signature cores: 3 before, 2 after',
  ]);
});

test('a failed check on rows in two installations lists both', () => {
  expect(mismatchLines(id, BEFORE, footprint(true, [7, 2, 1], [9, 1, 3]))).toEqual([
    'erase failed: the check after the erasure of GitHub id 42 does not hold',
    'signer_pii rows left: 4',
    'installation 7: 1 signer_pii rows left',
    'installation 9: 3 signer_pii rows left',
  ]);
});

test('where a loop stood is printed as ids, or none', () => {
  expect(partialLine([7], [9, 11])).toBe('installations done: 7; pending: 9, 11; running the command again is safe');
  expect(partialLine([], [7])).toBe('installations done: none; pending: 7; running the command again is safe');
  expect(partialLine([7, 9], [])).toBe('installations done: 7, 9; pending: none; running the command again is safe');
});

test.each([
  ['unknown', { kind: 'unknown' }, 1],
  ['nothing', { kind: 'nothing' }, 0],
  ['dry_run', { kind: 'dry_run', before: BEFORE }, 0],
  ['erased', { kind: 'erased', before: BEFORE, erased: [] }, 0],
  ['mismatch', { kind: 'mismatch', before: BEFORE, after: BEFORE }, 3],
  ['failed', { kind: 'failed', done: [], pending: [7], cause: new Error('x') }, 4],
] satisfies readonly (readonly [string, ErasureOutcome, number])[])(
  'the outcome %s exits %i',
  (_kind, outcome, code) => {
    expect(exitCodeOf(outcome)).toBe(code);
  },
);
