// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { GitHubUnavailableError } from '../../services/ports/github-errors.ts';
import { clientFixture, installationJson, json, repositoryJson } from './client-fixture/test-support.ts';

// The client of one job (E07-S03): `withSignal` binds the requests of the Octokit adapter to the signal of a job. The
// contract suite (octokit-client.contract.test.ts) has what every client answers; this is what only the adapter does.

const id = parseGithubId;

test('a view whose signal has not aborted fails exactly like the client: a 500 is an unavailable GitHub, a 404 is null', async () => {
  const { client } = clientFixture({
    'GET /app/installations/11': () => json({ message: 'broken' }, 500),
    'GET /app/installations/12': () => json({ message: 'Not Found' }, 404),
  });
  const view = client.withSignal(new AbortController().signal);
  await expect(view.getInstallation(id(11))).rejects.toBeInstanceOf(GitHubUnavailableError);
  expect(await view.getInstallation(id(12))).toBeNull();
});

test('a view sends through the same limiter and the same tokens as the client: the installation of its request is the one it names', async () => {
  const { client, calls } = clientFixture({ 'GET /repositories/101': () => json(repositoryJson(101, 'acme/api')) });
  const view = client.withSignal(new AbortController().signal);
  expect(await view.getRepositoryById(id(11), id(101))).toEqual({ id: 101, fullName: 'acme/api' });
  expect(calls[0]?.headers.get('authorization')).toBe('Bearer ghs_made-up-11-1');
});

test('an answer that comes after the signal aborted is thrown away: the call rejects with the reason of the signal, and nothing is repeated', async () => {
  const abort = new AbortController();
  const reason = new Error('the shutdown deadline passed');
  const { client, calls, waits } = clientFixture({
    'GET /app/installations/11': () => {
      abort.abort(reason);
      return json({ message: 'bad gateway' }, 502);
    },
  });
  await expect(client.withSignal(abort.signal).getInstallation(id(11))).rejects.toBe(reason);
  expect([calls.length, waits]).toEqual([1, []]);
});

test('a request that was cancelled is not sent again, and a request that was not is: only the abort stops the repeat of a GET', async () => {
  const { client, calls, waits } = clientFixture({
    'GET /app/installations/11': (() => {
      let answered = 0;
      return () => {
        answered += 1;
        return answered === 1 ? json({ message: 'bad gateway' }, 502) : json(installationJson(11));
      };
    })(),
  });
  const installation = await client.withSignal(new AbortController().signal).getInstallation(id(11));
  expect(installation?.id).toBe(11);
  expect([calls.length, waits]).toEqual([2, [1000]]);
});
