// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { id, installation, repositories, repository } from './github-contract/test-support.ts';
import { GitHubUnavailableError, InstallationNotAdmittedError } from './ports/github-errors.ts';
import { FakeGate, FakeGitHub } from './test-support.ts';

test('every call is recorded with its method and installation id, in order; App-level calls carry no id', async () => {
  const fake = new FakeGitHub();
  fake.addInstallation(installation(11, 'acme'), [repository(101, 'acme/api')]);
  await fake.getApp();
  await fake.listInstallations();
  await fake.getInstallation(id(11));
  await fake.listInstallationRepositories(id(11));
  await fake.getRepositoryById(id(11), id(101));
  await fake.getOrgMembership(id(11), 'acme', 'alice');
  await fake.getRepositoryPermission(id(11), 'acme', 'api', 'alice');
  await fake.getInstallation(id(99));
  expect(fake.calls).toEqual([
    { method: 'getApp', installationId: undefined },
    { method: 'listInstallations', installationId: undefined },
    { method: 'getInstallation', installationId: 11 },
    { method: 'listInstallationRepositories', installationId: 11 },
    { method: 'getRepositoryById', installationId: 11 },
    { method: 'getOrgMembership', installationId: 11 },
    { method: 'getRepositoryPermission', installationId: 11 },
    { method: 'getInstallation', installationId: 99 },
  ]);
});

test('a call the gate refuses throws InstallationNotAdmittedError and is not recorded', async () => {
  const gate = new FakeGate();
  const fake = new FakeGitHub({ gate });
  fake.addInstallation(installation(11, 'acme'));
  fake.addInstallation(installation(12, 'globex'));
  gate.refuse(id(11), 'rejected');
  await expect(fake.listInstallationRepositories(id(11))).rejects.toEqual(new InstallationNotAdmittedError('rejected'));
  await fake.listInstallationRepositories(id(12));
  expect(fake.calls).toEqual([{ method: 'listInstallationRepositories', installationId: 12 }]);
  expect(gate.asked).toEqual([11, 12]);
});

test('without a gate every installation GitHub has is served', async () => {
  const fake = new FakeGitHub();
  fake.addInstallation(installation(11, 'acme'), [repository(101, 'acme/api')]);
  expect(await fake.listInstallationRepositories(id(11))).toEqual([repository(101, 'acme/api')]);
});

test('a scripted failure is thrown once, by the next call of that method only, and the call is still recorded', async () => {
  const fake = new FakeGitHub();
  fake.addInstallation(installation(11, 'acme'), repositories(1, 2));
  const outage = new GitHubUnavailableError('down');
  fake.failNext('listInstallationRepositories', outage);
  await fake.getApp();
  await expect(fake.listInstallationRepositories(id(11))).rejects.toBe(outage);
  expect(await fake.listInstallationRepositories(id(11))).toHaveLength(2);
  expect(fake.calls.map((call) => call.method)).toEqual([
    'getApp',
    'listInstallationRepositories',
    'listInstallationRepositories',
  ]);
});

test('scripted failures of one method are thrown in the order they were scripted', async () => {
  const fake = new FakeGitHub();
  const first = new GitHubUnavailableError('first');
  const second = new GitHubUnavailableError('second');
  fake.failNext('listInstallations', first);
  fake.failNext('listInstallations', second);
  await expect(fake.listInstallations()).rejects.toBe(first);
  await expect(fake.listInstallations()).rejects.toBe(second);
  expect(await fake.listInstallations()).toEqual([]);
});

test('setRepositories replaces what an installation can reach; removeInstallation takes the installation away', async () => {
  const fake = new FakeGitHub();
  fake.addInstallation(installation(11, 'acme'), repositories(1, 3));
  fake.setRepositories(id(11), repositories(10, 1));
  expect(await fake.listInstallationRepositories(id(11))).toEqual(repositories(10, 1));
  fake.removeInstallation(id(11));
  expect(await fake.getInstallation(id(11))).toBeNull();
  expect(await fake.listInstallations()).toEqual([]);
});

test('suspend sets and lifts the suspension of an installation', async () => {
  const fake = new FakeGitHub();
  fake.addInstallation(installation(11, 'acme'));
  const at = new Date('2026-11-01T09:30:00Z');
  fake.suspend(id(11), at);
  expect((await fake.getInstallation(id(11)))?.suspendedAt).toEqual(at);
  fake.suspend(id(11), null);
  expect((await fake.getInstallation(id(11)))?.suspendedAt).toBeNull();
});

test('setApp changes the App getApp describes', async () => {
  const fake = new FakeGitHub();
  const app = { id: id(7), slug: 'other', owner: { id: id(8), type: 'User' as const }, permissions: {} };
  fake.setApp(app);
  expect(await fake.getApp()).toBe(app);
});

test.each([
  [
    'setRepositories',
    (fake: FakeGitHub) => {
      fake.setRepositories(id(5), []);
    },
  ],
  [
    'suspend',
    (fake: FakeGitHub) => {
      fake.suspend(id(5), null);
    },
  ],
])('%s on an installation never added is a mistake in the test, and says so', (_name, script) => {
  expect(() => {
    script(new FakeGitHub());
  }).toThrow('FakeGitHub has no installation 5: add it first');
});

test('the lists it returns are copies: changing one does not change the fake', async () => {
  const fake = new FakeGitHub();
  fake.addInstallation(installation(11, 'acme'), repositories(1, 2));
  (await fake.listInstallationRepositories(id(11))).pop();
  (await fake.listInstallations()).pop();
  expect(await fake.listInstallationRepositories(id(11))).toHaveLength(2);
  expect(await fake.listInstallations()).toHaveLength(1);
});

test('a view for a job (withSignal) serves from the world of the fake and records into its calls, with or without a gate (E07-S03)', async () => {
  const plain = new FakeGitHub();
  plain.addInstallation(installation(11, 'acme'), [repository(101, 'acme/api')]);
  expect(await plain.withSignal(new AbortController().signal).listInstallationRepositories(id(11))).toEqual([
    repository(101, 'acme/api'),
  ]);
  expect(plain.calls).toEqual([{ method: 'listInstallationRepositories', installationId: 11 }]);
  const gate = new FakeGate();
  const gated = new FakeGitHub({ gate });
  gated.addInstallation(installation(11, 'acme'));
  gate.refuse(id(11), 'rejected');
  await expect(gated.withSignal(new AbortController().signal).listInstallationRepositories(id(11))).rejects.toEqual(
    new InstallationNotAdmittedError('rejected'),
  );
  expect(gated.calls).toEqual([]);
});

test('a view shares what the test scripts on the fake: failures and hooks of the next call, and the world as it changes', async () => {
  const fake = new FakeGitHub();
  const view = fake.withSignal(new AbortController().signal);
  fake.addInstallation(installation(11, 'acme'));
  const outage = new GitHubUnavailableError('down');
  fake.failNext('getInstallation', outage);
  await expect(view.getInstallation(id(11))).rejects.toBe(outage);
  const order: string[] = [];
  fake.beforeNext('getInstallation', () => {
    order.push('hook');
    return Promise.resolve();
  });
  expect((await view.getInstallation(id(11)))?.id).toBe(11);
  expect(order).toEqual(['hook']);
});

test('a view whose signal has aborted records nothing, asks no gate and runs no hook', async () => {
  const gate = new FakeGate();
  const fake = new FakeGitHub({ gate });
  fake.addInstallation(installation(11, 'acme'));
  let hooked = false;
  fake.beforeNext('listInstallationRepositories', () => {
    hooked = true;
    return Promise.resolve();
  });
  const reason = new Error('aborted');
  await expect(fake.withSignal(AbortSignal.abort(reason)).listInstallationRepositories(id(11))).rejects.toBe(reason);
  expect([fake.calls, gate.asked, hooked]).toEqual([[], [], false]);
});

test('a hook that fails reaches the caller of a view as it does the caller of the fake', async () => {
  const fake = new FakeGitHub();
  fake.addInstallation(installation(11, 'acme'));
  const failure = new Error('the world broke');
  fake.beforeNext('getInstallation', () => Promise.reject(failure));
  await expect(fake.withSignal(new AbortController().signal).getInstallation(id(11))).rejects.toBe(failure);
});
