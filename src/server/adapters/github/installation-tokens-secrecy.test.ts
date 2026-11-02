// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { readdirSync, readFileSync } from 'node:fs';
import { inspect } from 'node:util';
import { HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { testGitHubKey } from '../../config/test-support.ts';
import { FakeClock } from '../../services/test-support.ts';
import { GITHUB_API_ORIGIN } from './github-http.ts';
import { hourlyTokens, type MintAnswer, mockGitHub, START, tokensFixture } from './test-support.ts';

const key = testGitHubKey();
const id = parseGithubId;
const MINUTE = 60_000;

/** What GitHub answers to the token request of each installation: 7 is healthy, the others fail in different ways. */
function answers(clock: FakeClock): MintAnswer {
  const issue = hourlyTokens(clock);
  return (call) => {
    switch (call.installationId) {
      case '8':
        return HttpResponse.json({ message: 'Not Found ghs_hostile-404' }, { status: 404 });
      case '9':
        return HttpResponse.json({ message: 'This installation has been suspended ghs_hostile-403' }, { status: 403 });
      case '10':
        return HttpResponse.json({ message: 'ghs_hostile-503' }, { status: 503 });
      case '11':
        return HttpResponse.json({ token: 'ghs_hostile-bad-shape', expires_at: 'ghs_hostile-date' }, { status: 201 });
      default:
        return issue(call);
    }
  };
}

test('a full mint-and-use cycle, refreshes and failures included, never puts a token or its ghs_ prefix in the log or in an error', async () => {
  const clock = new FakeClock(START);
  const authorizations: (string | null)[] = [];
  const routes = mockGitHub([key.publicKey], {
    mint: answers(clock),
    use: (authorization) => {
      authorizations.push(authorization);
      return HttpResponse.json({ total_count: 0, repositories: [] });
    },
  });
  const { tokens, logs } = tokensFixture([key.key], { clock });
  const useToken = async (installation: number): Promise<string> => {
    const issued = await tokens.get(id(installation));
    await fetch(`${GITHUB_API_ORIGIN}/installation/repositories`, {
      headers: { Authorization: `Bearer ${issued.token.reveal()}` },
    });
    return issued.token.reveal();
  };

  const first = await useToken(7);
  clock.advance(56 * MINUTE);
  const second = await useToken(7);
  await useToken(7);
  const errors = await Promise.all(
    [8, 9, 10, 11].map((installation) => tokens.get(id(installation)).catch((error: unknown) => error)),
  );

  expect([first, second]).toEqual(['ghs_made-up-7-1', 'ghs_made-up-7-2']);
  expect(authorizations).toEqual([`Bearer ${first}`, `Bearer ${second}`, `Bearer ${second}`]);
  expect(errors.map((error) => (error instanceof Error ? error.name : 'not an error'))).toEqual([
    'InstallationGoneError',
    'InstallationSuspendedError',
    'GitHubUnavailableError',
    'GitHubResponseError',
  ]);
  const logged = logs.text();
  expect(logs.lines().filter((line) => line['msg'] === 'github.installation_token_minted')).toMatchObject([
    { installationId: 7, expiresAt: '2026-11-02T11:00:00Z' },
    { installationId: 7, expiresAt: '2026-11-02T11:56:00Z' },
  ]);
  const printedErrors = errors.flatMap((error) => [String(error), inspect(error, { depth: 6 }), JSON.stringify(error)]);
  for (const text of [logged, ...printedErrors]) {
    expect(text).not.toContain('ghs_');
    expect(text).not.toContain('hostile');
  }
  for (const call of routes.mints) {
    expect(logged).not.toContain(call.jwt);
  }
});

test('a token prints as [REDACTED] however it is printed, and only reveal() gives the value', async () => {
  const clock = new FakeClock(START);
  mockGitHub([key.publicKey], { mint: hourlyTokens(clock) });
  const { tokens } = tokensFixture([key.key], { clock });
  const issued = await tokens.get(id(7));
  const printed = [
    String(issued.token),
    JSON.stringify(issued),
    inspect(issued, { depth: 6 }),
    JSON.stringify({ token: issued.token }),
  ].join('\n');
  expect(printed).not.toContain('ghs_');
  expect(printed).toContain('[REDACTED]');
  expect(issued.token.reveal()).toBe('ghs_made-up-7-1');
});

test('tokens are never persisted: no migration has a column or a value shaped like an installation token', () => {
  const migrations = readdirSync('migrations').filter((name) => name.endsWith('.sql'));
  expect(migrations.length).toBeGreaterThan(0);
  for (const name of migrations) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- test: a file just listed from the migrations folder
    expect(readFileSync(`migrations/${name}`, 'utf8')).not.toMatch(/installation_token|access_token|ghs_/i);
  }
});
