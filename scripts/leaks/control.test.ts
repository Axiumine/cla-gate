// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { collectIo } from '../ci/lib/test-support.ts';
import { CONTROL_CASES, runControl } from './control.ts';

// E20-S07: leaks:control compares the exit code of the real wrapper on three scenarios with the one each must give.

/** Runs the control with a wrapper that answers per scenario name (the file name without the directory and extension). */
async function control(answers: Readonly<Record<string, number>>) {
  const { io, out, err } = collectIo();
  const files: string[] = [];
  const code = await runControl({
    io,
    directory: '/repo/tests/leaks/control',
    runWrapper: (file) => {
      files.push(file);
      return Promise.resolve(answers[file.split('/').at(-1)?.replace('.ts', '') ?? ''] ?? -1);
    },
  });
  return { code, out, err, files };
}

const RIGHT = { clean: 0, leaking: 1, broken: 2 };

test('the cases are a clean fixture that must pass, a leaking one that must fail and a broken one that must be an error', () => {
  expect(CONTROL_CASES.map(({ name, expected }) => [name, expected])).toEqual([
    ['clean', 0],
    ['leaking', 1],
    ['broken', 2],
  ]);
  expect(CONTROL_CASES.every((each) => each.ifWrong.length > 20)).toBe(true);
});

test('when every scenario gives its expected code the control passes and says so', async () => {
  const { code, out, err, files } = await control(RIGHT);
  expect(code).toBe(0);
  expect(files).toEqual([
    '/repo/tests/leaks/control/clean.ts',
    '/repo/tests/leaks/control/leaking.ts',
    '/repo/tests/leaks/control/broken.ts',
  ]);
  expect(out).toEqual([
    'control clean: exit code 0, as expected',
    'control leaking: exit code 1, as expected',
    'control broken: exit code 2, as expected',
    'control: the wrapper fails when it must and passes when it may',
  ]);
  expect(err).toEqual([]);
});

test('a wrapper that exits 0 on the leaking fixture is blind: the control fails and says what that means', async () => {
  const { code, err, out } = await control({ ...RIGHT, leaking: 0 });
  expect(code).toBe(1);
  expect(err).toEqual([
    'control leaking: exit code 0, expected 1: detached DOM nodes kept in a global array are not reported: memlab or the wrapper is blind to leaks',
  ]);
  expect(out.at(-1)).toBe('control: 1 case(s) wrong');
});

test('a clean fixture reported as a leak fails the control', async () => {
  const { code, err } = await control({ ...RIGHT, clean: 1 });
  expect(code).toBe(1);
  expect(err[0]).toContain('control clean: exit code 1, expected 0: a clean fixture is reported as a failure');
});

test.each([[0], [1], [127]])(
  'a broken scenario that ends with code %i instead of 2 fails the control',
  async (broken) => {
    const { code, err } = await control({ ...RIGHT, broken });
    expect(code).toBe(1);
    expect(err[0]).toContain(
      `control broken: exit code ${broken}, expected 2: a scenario that cannot run does not end in the error code`,
    );
  },
);

test('every case runs even when the first is wrong, and all the problems are counted', async () => {
  const { code, files, out, err } = await control({ clean: 2, leaking: 2, broken: 0 });
  expect(code).toBe(1);
  expect(files).toHaveLength(3);
  expect(err).toHaveLength(3);
  expect(out).toEqual(['control: 3 case(s) wrong']);
});
