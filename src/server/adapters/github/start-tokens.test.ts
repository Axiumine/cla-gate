// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { testGitHubKey } from '../../config/test-support.ts';
import { GitHubUnavailableError, InstallationNotAdmittedError } from '../../services/ports/github-errors.ts';
import { FakeClock, FakeGate } from '../../services/test-support.ts';
import { captureLogs, testConfig } from '../../test-support.ts';
import { createLogger } from '../http/logger.ts';
import { startGitHubApp } from './start.ts';
import { APP_ID, appBody, hourlyTokens, jwtSignedBy, mockGitHub, START } from './test-support.ts';

const key = testGitHubKey();
const id = parseGithubId;

function start(gate?: FakeGate, clock = new FakeClock(START)) {
  return startGitHubApp({
    config: testConfig({ GITHUB_APP_ID: APP_ID, GITHUB_APP_PRIVATE_KEY: key.pem }),
    logger: createLogger({ logLevel: 'info' }, captureLogs().destination),
    clock,
    fetch,
    ...(gate === undefined ? {} : { gate }),
  });
}

test('the App carries the installation token provider, and without a gate it refuses every installation', async () => {
  const clock = new FakeClock(START);
  const routes = mockGitHub([key.publicKey], { mint: hourlyTokens(clock) });
  const app = await start(undefined, clock);
  await expect(app?.installationTokens.get(id(7))).rejects.toBeInstanceOf(InstallationNotAdmittedError);
  expect(routes.mints).toEqual([]);
});

test('with a gate that admits the installation a token is minted with a JWT of the App key, after the self-check', async () => {
  const clock = new FakeClock(START);
  const order: string[] = [];
  const issue = hourlyTokens(clock);
  const routes = mockGitHub([key.publicKey], {
    app: () => {
      order.push('GET /app');
      return HttpResponse.json(appBody());
    },
    mint: (call) => {
      order.push('POST access_tokens');
      return issue(call);
    },
  });
  const app = await start(new FakeGate(), clock);
  expect((await app?.installationTokens.get(id(7)))?.token.reveal()).toBe('ghs_made-up-7-1');
  expect(order).toEqual(['GET /app', 'POST access_tokens']);
  expect(jwtSignedBy(routes.mints[0]?.jwt ?? '', key.publicKey)).toBe(true);
});

test('a self-check that an outage skipped at start-up is repeated before the first token is minted', async () => {
  const clock = new FakeClock(START);
  const state = { up: false };
  const order: string[] = [];
  const issue = hourlyTokens(clock);
  mockGitHub([key.publicKey], {
    app: () => {
      order.push(state.up ? 'GET /app (up)' : 'GET /app (down)');
      return state.up ? HttpResponse.json(appBody()) : new HttpResponse(null, { status: 503 });
    },
    mint: (call) => {
      order.push('POST access_tokens');
      return issue(call);
    },
  });
  const app = await start(new FakeGate(), clock);
  await expect(app?.installationTokens.get(id(7))).rejects.toBeInstanceOf(GitHubUnavailableError);
  expect(order).toEqual(['GET /app (down)', 'GET /app (down)']);
  state.up = true;
  await app?.installationTokens.get(id(7));
  expect(order).toEqual(['GET /app (down)', 'GET /app (down)', 'GET /app (up)', 'POST access_tokens']);
});
