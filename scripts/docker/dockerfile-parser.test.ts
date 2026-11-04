// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { argsOf, parseDockerfile, stageNamed } from './test-support.ts';

// E19-S01: the small Dockerfile reader of the image tests, tested on made-up text so that a test of the real Dockerfile
// can trust what it reads.

const SAMPLE = `# a comment
ARG VERSION=1

FROM --platform=linux/amd64 registry.example/base:1@sha256:abc AS Base
  # an indented comment
run echo one \\
    # a comment inside a continuation
    && echo two
COPY a b ./

FROM base
CMD ["x"]
`;

test('comments and blank lines are not instructions, a backslash joins lines, and keywords are upper-cased', () => {
  const { stages } = parseDockerfile(SAMPLE);
  expect(stages[0]?.instructions).toEqual([
    { keyword: 'RUN', args: 'echo one && echo two' },
    { keyword: 'COPY', args: 'a b ./' },
  ]);
});

test('the instructions before the first FROM are the header', () => {
  expect(parseDockerfile(SAMPLE).header).toEqual([{ keyword: 'ARG', args: 'VERSION=1' }]);
});

test('a stage has its lower-case AS name and the image it starts from, without the FROM flags', () => {
  const { stages } = parseDockerfile(SAMPLE);
  expect(stages.map(({ name, from }) => [name, from])).toEqual([
    ['base', 'registry.example/base:1@sha256:abc'],
    ['', 'base'],
  ]);
});

test('argsOf lists the arguments of one keyword in order, and stageNamed finds a stage by name', () => {
  const dockerfile = parseDockerfile(SAMPLE);
  expect(argsOf(stageNamed(dockerfile, 'base'), 'COPY')).toEqual(['a b ./']);
  expect(argsOf(stageNamed(dockerfile, 'base'), 'USER')).toEqual([]);
});

test('asking for a stage that does not exist fails with its name', () => {
  expect(() => stageNamed(parseDockerfile(SAMPLE), 'runtime')).toThrow('the Dockerfile has no stage runtime');
});

test('text with no FROM has a header and no stage', () => {
  expect(parseDockerfile('ARG A=1\n')).toEqual({ header: [{ keyword: 'ARG', args: 'A=1' }], stages: [] });
});

test('a FROM without an image, and an AS without a name, give empty strings and do not stop the reader', () => {
  const { stages } = parseDockerfile('FROM\nFROM x AS\n');
  expect(stages.map(({ name, from }) => [name, from])).toEqual([
    ['', ''],
    ['', 'x'],
  ]);
});
