// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { NAME_PATTERN, ownedName } from './container-owner.ts';
import { E2E_OWNER, IMAGE_PATTERN, isMountable, runArguments } from './e2e-run.ts';

const DIGEST = 'a'.repeat(64);
const IMAGE = `mcr.microsoft.com/playwright:v1.64.1-noble@sha256:${DIGEST}`;
const OPTIONS = {
  name: 'cla-e2e-7-1-beef0001',
  image: IMAGE,
  workspace: '/home/runner/work/r',
  user: '1001:121',
  ci: '',
};

test('docker run removes the container at the end, labels it, mounts the repository and runs as the runner user', () => {
  expect(runArguments(OPTIONS, ['yarn', 'e2e'])).toEqual([
    'run',
    '--rm',
    '--init',
    '--ipc=host',
    '--network',
    'host',
    '--name',
    'cla-e2e-7-1-beef0001',
    '--label',
    'cla-gate.ci=e2e',
    '--user',
    '1001:121',
    '--volume',
    '/home/runner/work/r:/work',
    '--workdir',
    '/work',
    '--env',
    'E2E_CONTAINER=1',
    '--env',
    'SKIP_YARN_COREPACK_CHECK=1',
    '--env',
    'HOME=/tmp',
    '--env',
    'DATABASE_URL',
    IMAGE,
    'yarn',
    'e2e',
  ]);
});

test('the database URL is named without a value, so the password stays out of the process list', () => {
  const args = runArguments(OPTIONS, ['yarn', 'e2e']);
  expect(args[args.indexOf('DATABASE_URL') - 1]).toBe('--env');
  expect(args.filter((arg) => arg.startsWith('DATABASE_URL='))).toEqual([]);
});

test('a CI value is passed on, and nothing is passed when there is none', () => {
  expect(runArguments({ ...OPTIONS, ci: 'true' }, ['x'])).toContain('CI=true');
  expect(runArguments(OPTIONS, ['x']).filter((arg) => arg.startsWith('CI'))).toEqual([]);
});

test('the command arguments come after the image, untouched', () => {
  const args = runArguments(OPTIONS, ['yarn', 'e2e', '--update-snapshots=all']);
  expect(args.slice(args.indexOf(IMAGE) + 1)).toEqual(['yarn', 'e2e', '--update-snapshots=all']);
});

test.each([
  ['the pinned shape', IMAGE, true],
  ['a tag without a digest', 'mcr.microsoft.com/playwright:v1.64.1-noble', false],
  ['a digest of 63 characters', `mcr.microsoft.com/playwright:v1.64.1-noble@sha256:${'a'.repeat(63)}`, false],
  ['an upper-case digest', `mcr.microsoft.com/playwright:v1.64.1-noble@sha256:${'A'.repeat(64)}`, false],
  ['another registry', `example.org/playwright:v1.64.1-noble@sha256:${DIGEST}`, false],
  ['another image', `mcr.microsoft.com/dotnet/sdk:v1.64.1-noble@sha256:${DIGEST}`, false],
  ['another flavour', `mcr.microsoft.com/playwright:v1.64.1-jammy@sha256:${DIGEST}`, false],
  ['a range', `mcr.microsoft.com/playwright:v^1.64.1-noble@sha256:${DIGEST}`, false],
  ['an option after the digest', `${IMAGE}\n--privileged`, false],
  ['a space and an option', `${IMAGE} --privileged`, false],
])('the image pattern accepts only the pinned shape: %s', (_what, image, accepted) => {
  expect(IMAGE_PATTERN.test(image)).toBe(accepted);
});

test('the first group of the image pattern is the Playwright version', () => {
  expect(IMAGE_PATTERN.exec(IMAGE)?.[1]).toBe('1.64.1');
});

test.each([
  ['an absolute path', '/home/runner/work/cla-gate/cla-gate', true],
  ['a path with a space', '/home/some one/repo', true],
  ['a relative path', 'work/repo', false],
  ['an empty path', '', false],
  ['a path with a colon, which would end the host side of --volume', '/home/x:/etc', false],
  ['a path with a newline', '/home/x\ny', false],
  ['a path with an escape character', '/home/\u001bx', false],
])('a workspace can be mounted: %s', (_what, workspace, mountable) => {
  expect(isMountable(workspace)).toBe(mountable);
});

test('a container name of this helper fits what Docker accepts and starts with the prefix', () => {
  const name = ownedName(E2E_OWNER, { GITHUB_RUN_ID: '9', GITHUB_RUN_ATTEMPT: '2' }, 'beef0001');
  expect(name).toBe('cla-e2e-9-2-beef0001');
  expect(NAME_PATTERN.test(name)).toBe(true);
});
