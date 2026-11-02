// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { testGitHubKey } from '../../config/test-support.ts';
import { GitHubAuthError, InstallationNotAdmittedError } from '../../services/ports/github-errors.ts';
import { FakeClock } from '../../services/test-support.ts';
import { captureLogs, testConfig } from '../../test-support.ts';
import { createLogger } from '../http/logger.ts';
import {
  installationJson,
  json,
  line,
  type RouteCall,
  repositoryJson,
  serveRoutes,
} from './client-fixture/test-support.ts';
import { startGitHubApp } from './start.ts';
import { APP_ID, appBody, jwtSignedBy, START } from './test-support.ts';

// The client as the boot builds it (E05-S04): the same signer, self-check and token provider as the rest of the App.

const id = parseGithubId;

const bearer = (call: RouteCall): string => (call.headers.get('authorization') ?? '').replace(/^Bearer /, '');

async function start(env: Record<string, string>) {
  const logs = captureLogs();
  const app = await startGitHubApp({
    config: testConfig({ GITHUB_APP_ID: APP_ID, ...env }),
    logger: createLogger({ logLevel: 'info' }, logs.destination),
    clock: new FakeClock(START),
    fetch,
  });
  return { app, logs };
}

test('the App carries the client, and without a gate every installation-level call is refused before any request', async () => {
  const signer = testGitHubKey();
  const calls = serveRoutes({
    'GET /app': () => json(appBody()),
    'GET /installation/repositories': () => json({ repositories: [repositoryJson(101)] }),
  });
  const { app } = await start({ GITHUB_APP_PRIVATE_KEY: signer.pem });
  await expect(app?.client.listInstallationRepositories(id(11))).rejects.toEqual(
    new InstallationNotAdmittedError('not_wired'),
  );
  expect(calls.map(line)).toEqual(['GET /app']);
});

test('a call made as the App signs with the key GitHub accepts: the fallback to the previous key sticks', async () => {
  const current = testGitHubKey();
  const previous = testGitHubKey();
  const accepted = (call: RouteCall): boolean => jwtSignedBy(bearer(call), previous.publicKey);
  const refused = () => json({ message: 'A JSON web token could not be decoded' }, 401);
  const calls = serveRoutes({
    'GET /app': (call) => (accepted(call) ? json(appBody()) : refused()),
    'GET /app/installations/:id': (call) => (accepted(call) ? json(installationJson(11)) : refused()),
  });
  const { app, logs } = await start({
    GITHUB_APP_PRIVATE_KEY: current.pem,
    GITHUB_APP_PRIVATE_KEY_PREVIOUS: previous.pem,
  });
  expect((await app?.client.getInstallation(id(11)))?.id).toBe(11);
  expect(calls.map((call) => jwtSignedBy(bearer(call), previous.publicKey))).toEqual([false, true, true]);
  expect(logs.lines().filter((entry) => entry['msg'] === 'github.app_key_fallback')).toHaveLength(1);
});

test('when every key is refused the client call is GitHubAuthError', async () => {
  const signer = testGitHubKey();
  serveRoutes({
    'GET /app': () => json(appBody()),
    'GET /app/installations': () => json({ message: 'A JSON web token could not be decoded' }, 401),
  });
  const { app } = await start({ GITHUB_APP_PRIVATE_KEY: signer.pem });
  await expect(app?.client.listInstallations()).rejects.toBeInstanceOf(GitHubAuthError);
});

test('a self-check that an outage skipped at start-up runs before the client sends its first request', async () => {
  const signer = testGitHubKey();
  const state = { up: false };
  const calls = serveRoutes({
    'GET /app': () => (state.up ? json(appBody()) : json({ message: 'down' }, 500)),
    'GET /app/installations': () => json([]),
  });
  const { app } = await start({ GITHUB_APP_PRIVATE_KEY: signer.pem });
  state.up = true;
  expect(await app?.client.listInstallations()).toEqual([]);
  expect(calls.map(line)).toEqual(['GET /app', 'GET /app', 'GET /app/installations?per_page=100']);
});
