// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { delay } from 'msw';
import { expect, test } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import { testGitHubKey } from '../../config/test-support.ts';
import { InstallationNotAdmittedError, type NotAdmittedReason } from '../../services/ports/github-errors.ts';
import type { InstallationGate } from '../../services/ports/installation-gate.ts';
import { FakeClock } from '../../services/test-support.ts';
import { hourlyTokens, mockGitHub, START, tokensFixture, tokenWorld } from './test-support.ts';

const key = testGitHubKey();
const id = parseGithubId;
const MINUTE = 60_000;

/** A provider that was given no gate at all: a missing wiring. */
function ungated() {
  const clock = new FakeClock(START);
  const { mints } = mockGitHub([key.publicKey], { mint: hourlyTokens(clock) });
  return { ...tokensFixture([key.key], { clock, gate: null }), mints };
}

test('with no gate wired the provider refuses every installation and makes no request', async () => {
  const { tokens, mints } = ungated();
  const failure: unknown = await tokens.get(id(7)).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(InstallationNotAdmittedError);
  expect(failure).toMatchObject({ reason: 'not_wired', message: 'The installation is not served (not_wired)' });
  await expect(tokens.get(id(8))).rejects.toBeInstanceOf(InstallationNotAdmittedError);
  expect(mints).toEqual([]);
});

test.each<[NotAdmittedReason]>([['rejected'], ['deleted'], ['suspended'], ['unknown']])(
  'a gate that refuses an installation as %s stops the call before any request, with that reason',
  async (reason) => {
    const { tokens, mints, gate } = tokenWorld(key);
    gate.refuse(id(7), reason);
    await expect(tokens.get(id(7))).rejects.toMatchObject({ name: 'InstallationNotAdmittedError', reason });
    expect(mints).toEqual([]);
    expect(tokens.size).toBe(0);
  },
);

test('the gate is asked about the installation of every call, cached or not', async () => {
  const { tokens, gate } = tokenWorld(key);
  await tokens.get(id(7));
  await tokens.get(id(7));
  await tokens.get(id(8));
  expect(gate.asked).toEqual([7, 7, 8]);
});

test('an admitted installation is served while another is refused', async () => {
  const { tokens, mints, gate } = tokenWorld(key);
  gate.refuse(id(8), 'rejected');
  expect((await tokens.get(id(7))).token.reveal()).toBe('ghs_made-up-7-1');
  await expect(tokens.get(id(8))).rejects.toBeInstanceOf(InstallationNotAdmittedError);
  expect(mints.map((call) => call.installationId)).toEqual(['7']);
});

test('an installation that stops being served is refused even though its token is cached, and the token is dropped', async () => {
  const { tokens, mints, gate, clock } = tokenWorld(key);
  await tokens.get(id(7));
  await tokens.get(id(8));
  gate.refuse(id(7), 'suspended');
  clock.advance(MINUTE);
  await expect(tokens.get(id(7))).rejects.toMatchObject({ reason: 'suspended' });
  expect(tokens.size).toBe(1);
  expect(mints).toHaveLength(2);
  gate.admit(id(7));
  expect((await tokens.get(id(7))).token.reveal()).toBe('ghs_made-up-7-3');
  expect(mints).toHaveLength(3);
});

test('a gate that fails for its own reasons fails the call closed with that error, and nothing is requested', async () => {
  const outage = new Error('gate lookup failed');
  const broken: InstallationGate = { assertAdmitted: () => Promise.reject(outage) };
  const clock = new FakeClock(START);
  const { mints } = mockGitHub([key.publicKey], { mint: hourlyTokens(clock) });
  const { tokens } = tokensFixture([key.key], { clock, gate: broken });
  await expect(tokens.get(id(7))).rejects.toBe(outage);
  expect(mints).toEqual([]);
});

test('50 concurrent calls are each checked by the gate and still share one POST', async () => {
  const { tokens, mints, gate } = tokenWorld(key, (clock) => {
    const issue = hourlyTokens(clock);
    return async (call) => {
      await delay(30);
      return issue(call);
    };
  });
  await Promise.all(Array.from({ length: 50 }, () => tokens.get(id(7))));
  expect(gate.asked).toHaveLength(50);
  expect(mints).toHaveLength(1);
});
