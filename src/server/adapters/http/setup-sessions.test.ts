// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { FakeClock } from '../../services/test-support.ts';
import { createSetupSessions, SETUP_IDLE_MS, SETUP_MAX_SESSIONS } from './setup-sessions.ts';

// E19-S06: the in-memory store of the setup sessions: 30 minutes idle, at most three alive, the one used longest ago goes.

const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/u;

function store() {
  const clock = new FakeClock('2026-11-03T09:00:00.000Z');
  return { clock, sessions: createSetupSessions(clock) };
}

test('the limits are the ones of the story, spelled out here on purpose', () => {
  expect(SETUP_IDLE_MS).toBe(30 * 60 * 1000);
  expect(SETUP_MAX_SESSIONS).toBe(3);
});

test('an opened session has a random id and a random CSRF token of 256 bits each, and no state yet', () => {
  const { sessions } = store();
  const first = sessions.open();
  const second = sessions.open();
  expect(first.id).toMatch(BASE64URL_43);
  expect(first.csrfToken).toMatch(BASE64URL_43);
  expect(new Set([first.id, first.csrfToken, second.id, second.csrfToken]).size).toBe(4);
  expect(first.state).toBeUndefined();
});

test('a session is found by its id, and an id that was never issued, or none, finds nothing', () => {
  const { sessions } = store();
  const session = sessions.open();
  expect(sessions.find(session.id)).toBe(session);
  expect(sessions.find('x'.repeat(43))).toBeUndefined();
  expect(sessions.find('')).toBeUndefined();
  expect(sessions.find(undefined)).toBeUndefined();
});

test('a session is found until it has been idle for more than 30 minutes, and then it is forgotten', () => {
  const { clock, sessions } = store();
  const session = sessions.open();
  clock.advance(SETUP_IDLE_MS);
  expect(sessions.find(session.id)).toBe(session);
  clock.advance(1);
  expect(sessions.find(session.id)).toBeUndefined();
});

test('finding a session does not start its idle time over, renewing it does', () => {
  const { clock, sessions } = store();
  const session = sessions.open();
  clock.advance(SETUP_IDLE_MS - 1);
  sessions.find(session.id);
  clock.advance(2);
  expect(sessions.find(session.id)).toBeUndefined();
  const renewed = sessions.open();
  clock.advance(SETUP_IDLE_MS - 1);
  sessions.renew(renewed);
  clock.advance(SETUP_IDLE_MS);
  expect(sessions.find(renewed.id)).toBe(renewed);
});

test('the fourth open ends the session that was used longest ago, not the one opened first', () => {
  const { clock, sessions } = store();
  const [first, second, third] = [sessions.open(), sessions.open(), sessions.open()];
  clock.advance(1000);
  sessions.renew(first);
  const fourth = sessions.open();
  expect(sessions.find(second.id)).toBeUndefined();
  expect([first, third, fourth].map((session) => sessions.find(session.id))).toEqual([first, third, fourth]);
});

test('idle sessions make room before a live one is pushed out', () => {
  const { clock, sessions } = store();
  const old = sessions.open();
  clock.advance(SETUP_IDLE_MS + 1);
  const [a, b] = [sessions.open(), sessions.open()];
  const c = sessions.open();
  expect(sessions.find(old.id)).toBeUndefined();
  expect([a, b, c].map((session) => sessions.find(session.id))).toEqual([a, b, c]);
});

test('a state is issued to a session, replaces the one before, and is different for every session', () => {
  const { sessions } = store();
  const [mine, other] = [sessions.open(), sessions.open()];
  const first = sessions.issueState(mine);
  expect(first).toMatch(BASE64URL_43);
  expect(mine.state).toBe(first);
  const second = sessions.issueState(mine);
  expect(second).not.toBe(first);
  expect(mine.state).toBe(second);
  expect(other.state).toBeUndefined();
  expect(sessions.issueState(other)).not.toBe(second);
});

test('a state that is consumed is gone from its session alone, and a new one can be issued after it (E19-S11)', () => {
  const { sessions } = store();
  const [mine, other] = [sessions.open(), sessions.open()];
  const kept = sessions.issueState(other);
  sessions.issueState(mine);
  sessions.consumeState(mine);
  expect(mine.state).toBeUndefined();
  expect(other.state).toBe(kept);
  expect(sessions.issueState(mine)).toMatch(BASE64URL_43);
});

test('the credentials were issued for no one until they are, then for every session and for as long as the process lives (E19-S11)', () => {
  const { clock, sessions } = store();
  const early = sessions.open();
  expect(sessions.credentialsIssued).toBe(false);
  sessions.markCredentialsIssued();
  expect(sessions.credentialsIssued).toBe(true);
  clock.advance(SETUP_IDLE_MS * 10);
  expect(sessions.find(early.id)).toBeUndefined();
  sessions.open();
  expect(sessions.credentialsIssued).toBe(true);
  expect(store().sessions.credentialsIssued).toBe(false);
});

test('a state that was consumed can be given back to its session, and to that session alone (E19-S11)', () => {
  const { sessions } = store();
  const [mine, other] = [sessions.open(), sessions.open()];
  const state = sessions.issueState(mine);
  sessions.consumeState(mine);
  sessions.restoreState(mine, state);
  expect(mine.state).toBe(state);
  expect(other.state).toBeUndefined();
});

test('a state is not given back over a newer one: the manifest issued meanwhile is the one that can be completed (E19-S11)', () => {
  const { sessions } = store();
  const session = sessions.open();
  const old = sessions.issueState(session);
  sessions.consumeState(session);
  const newer = sessions.issueState(session);
  sessions.restoreState(session, old);
  expect(session.state).toBe(newer);
});
