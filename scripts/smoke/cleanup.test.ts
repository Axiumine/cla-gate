// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import type { Exec, ExecResult } from '../ci/lib/exec.ts';
import { fail, ok } from '../ci/lib/test-support.ts';
import { removeRun } from './cleanup.ts';

// E19-S08: the clean-up of a run on a shared Docker daemon removes what carries the run's labels and nothing else.

const RUN = 'cla-smoke-9-1';
const FILTERS = ['--quiet', '--filter', 'label=cla-gate.ci=container', '--filter', `label=cla-gate.run=${RUN}`];

/** A docker that answers by the start of the command line it is given (`ps --all`, `network rm`); anything unscripted succeeds with no output. */
function daemon(replies: Readonly<Record<string, ExecResult>> = {}): { exec: Exec; calls: string[] } {
  const calls: string[] = [];
  const scripted = [...Object.entries(replies)];
  const exec: Exec = (_file, args) => {
    const line = args.join(' ');
    calls.push(line);
    const reply = scripted.find(([prefix]) => line.startsWith(prefix));
    return Promise.resolve(reply === undefined ? ok() : reply[1]);
  };
  return { exec, calls };
}

const PROJECTS = JSON.stringify([
  { Name: `${RUN}-boot`, Status: 'running(3)' },
  { Name: `${RUN}-tls`, Status: 'exited(1)' },
  { Name: 'cla-smoke-9-2-boot', Status: 'running(3)' },
  { Name: 'somebody-elses', Status: 'running(1)' },
]);

test('the compose projects of the run are taken down with their volumes, and no other project is touched', async () => {
  const { exec, calls } = daemon({ 'compose ls': ok(PROJECTS) });
  const removed = await removeRun(exec, RUN);
  expect(removed.projects).toEqual([`${RUN}-boot`, `${RUN}-tls`]);
  expect(calls.filter((line) => line.startsWith('compose --project-name'))).toEqual([
    `compose --project-name ${RUN}-boot down --volumes --remove-orphans`,
    `compose --project-name ${RUN}-tls down --volumes --remove-orphans`,
  ]);
});

test('a run is not mistaken for another that starts with the same characters', async () => {
  const { exec } = daemon({ 'compose ls': ok(JSON.stringify([{ Name: 'cla-smoke-9-10-boot' }])) });
  expect((await removeRun(exec, RUN)).projects).toEqual([]);
});

test('what is left is found by the two labels of the run: containers, networks, volumes and images, in that order', async () => {
  const { exec, calls } = daemon({
    'ps --all': ok('c1\nc2\n'),
    'network ls': ok('n1\n'),
    'volume ls': ok('v1\nv2\nv3\n'),
    'image ls': ok('i1\n'),
  });
  const removed = await removeRun(exec, RUN);
  expect(removed).toEqual({ projects: [], containers: 2, networks: 1, volumes: 3, images: 1 });
  expect(calls).toEqual([
    'compose ls --all --format json',
    `ps --all ${FILTERS.join(' ')}`,
    'rm --force --volumes c1 c2',
    `network ls ${FILTERS.join(' ')}`,
    'network rm n1',
    `volume ls ${FILTERS.join(' ')}`,
    'volume rm --force v1 v2 v3',
    `image ls ${FILTERS.join(' ')}`,
    'image rm --force i1',
  ]);
});

test('nothing left is not an error and nothing is removed', async () => {
  const { exec, calls } = daemon({ 'compose ls': ok('') });
  expect(await removeRun(exec, RUN)).toEqual({ projects: [], containers: 0, networks: 0, volumes: 0, images: 0 });
  expect(calls.filter((line) => /(^| )rm /.test(line))).toEqual([]);
});

test('a failing list does not stop the other kinds, and is reported at the end', async () => {
  const { exec, calls } = daemon({ 'network ls': fail('cannot connect'), 'volume ls': ok('v1\n') });
  await expect(removeRun(exec, RUN)).rejects.toThrow('docker network ls failed: cannot connect');
  expect(calls).toContain('volume rm --force v1');
});

test("a failing removal is reported with the first line of docker's message, after the other kinds were tried", async () => {
  const { exec, calls } = daemon({
    'ps --all': ok('c1\n'),
    'rm --force --volumes': fail('Error: removal of c1 is already in progress\nmore'),
    'image ls': ok('i1\n'),
  });
  await expect(removeRun(exec, RUN)).rejects.toThrow(
    'docker rm --force --volumes failed: Error: removal of c1 is already in progress',
  );
  expect(calls).toContain('image rm --force i1');
});

test('two failures are both reported', async () => {
  const { exec } = daemon({ 'network ls': fail('a'), 'volume ls': fail('b') });
  await expect(removeRun(exec, RUN)).rejects.toThrow('docker network ls failed: a; docker volume ls failed: b');
});

test('a daemon that cannot list compose projects stops the clean-up with its message', async () => {
  const { exec } = daemon({ 'compose ls': fail('Cannot connect to the Docker daemon') });
  await expect(removeRun(exec, RUN)).rejects.toThrow('docker compose ls failed: Cannot connect to the Docker daemon');
});
