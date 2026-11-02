// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import type { GithubId } from '../../shared/github-id.ts';
import {
  createRevokeUserSessionsHandler,
  InvalidJobPayloadError,
  REVOKE_USER_SESSIONS_JOB,
  revokeUserSessionsPayloadSchema,
} from './revoke-user-sessions.ts';

// The handler of the `revoke-user-sessions` job (E10-S07) with a store that only remembers what it was asked: the
// envelope check, what is logged, and what happens when the deletion fails. The real deletion and the old cookies that
// stop working are in adapters/http/auth-revoke-sessions.test.ts.

const valid = { type: REVOKE_USER_SESSIONS_JOB, githubUserId: 1001 };

function handlerWith(removed: number | Error = 3) {
  const asked: GithubId[] = [];
  const info = vi.fn();
  const handler = createRevokeUserSessionsHandler({
    sessions: {
      removeAllOfGithubId: (githubId) => {
        asked.push(githubId);
        return removed instanceof Error ? Promise.reject(removed) : Promise.resolve(removed);
      },
    },
    log: { info },
  });
  return { handler, asked, info };
}

test('a valid envelope deletes the sessions of that id and resolves to the count', async () => {
  const { handler, asked } = handlerWith(3);
  expect(await handler(valid)).toBe(3);
  expect(asked).toEqual([1001]);
});

test('the log line carries the numeric id and the count and nothing else', async () => {
  const { handler, info } = handlerWith(3);
  await handler({ ...valid, deliveryId: 'a-delivery-id' });
  expect(info).toHaveBeenCalledExactlyOnceWith({ githubUserId: 1001, revoked: 3 }, 'auth.sessions_revoked');
});

test('a person with no session completes with count 0 and the line says so', async () => {
  const { handler, info } = handlerWith(0);
  expect(await handler(valid)).toBe(0);
  expect(info).toHaveBeenCalledExactlyOnceWith({ githubUserId: 1001, revoked: 0 }, 'auth.sessions_revoked');
});

test('keys the schema does not know are dropped, so a revocation is not lost to an extra field', async () => {
  const { handler, asked, info } = handlerWith(2);
  expect(await handler({ ...valid, login: 'octocat', installationId: 77, githubId: 5 })).toBe(2);
  expect(asked).toEqual([1001]);
  expect(info).toHaveBeenCalledExactlyOnceWith({ githubUserId: 1001, revoked: 2 }, 'auth.sessions_revoked');
});

test.each([
  ['null', null],
  ['undefined', undefined],
  ['a string', '1001'],
  ['an array', [valid]],
  ['an empty object', {}],
  ['no type', { githubUserId: 1001 }],
  ['another type', { type: 'evaluate-pr', githubUserId: 1001 }],
  ['no id', { type: REVOKE_USER_SESSIONS_JOB }],
  ['the id as a string', { ...valid, githubUserId: '1001' }],
  ['the id as an e-mail address', { ...valid, githubUserId: 'jane@example.com' }],
  ['id 0', { ...valid, githubUserId: 0 }],
  ['a negative id', { ...valid, githubUserId: -5 }],
  ['a fractional id', { ...valid, githubUserId: 1.5 }],
  ['an id beyond the safe integers', { ...valid, githubUserId: 2 ** 53 }],
  ['an infinite id', { ...valid, githubUserId: Number.POSITIVE_INFINITY }],
  ['a null id', { ...valid, githubUserId: null }],
  ['an empty delivery id', { ...valid, deliveryId: '' }],
  ['a delivery id of 101 characters', { ...valid, deliveryId: 'd'.repeat(101) }],
  ['a delivery id that is not text', { ...valid, deliveryId: 7 }],
])('%s is refused as job_payload_invalid before anything is deleted or logged', async (_label, data) => {
  const { handler, asked, info } = handlerWith();
  await expect(handler(data)).rejects.toBeInstanceOf(InvalidJobPayloadError);
  expect(asked).toEqual([]);
  expect(info).not.toHaveBeenCalled();
});

test('the refusal has a fixed message and a code, and never quotes the payload', async () => {
  const { handler } = handlerWith();
  const error = await handler({ ...valid, githubUserId: 'jane@example.com' }).catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(InvalidJobPayloadError);
  expect(error).toMatchObject({ code: 'job_payload_invalid', message: 'job_payload_invalid' });
  expect(JSON.stringify(error)).not.toContain('jane');
});

test('a failing deletion is not swallowed: the same error reaches the worker, which retries, and nothing is logged as done', async () => {
  const failure = new Error('connection terminated');
  const { handler, info } = handlerWith(failure);
  await expect(handler(valid)).rejects.toBe(failure);
  expect(info).not.toHaveBeenCalled();
});

test('the schema accepts the largest GitHub id a JavaScript number holds and a delivery id of 100 characters', () => {
  const parsed = revokeUserSessionsPayloadSchema.parse({
    type: REVOKE_USER_SESSIONS_JOB,
    deliveryId: 'd'.repeat(100),
    githubUserId: Number.MAX_SAFE_INTEGER,
  });
  expect(parsed.githubUserId).toBe(Number.MAX_SAFE_INTEGER);
});
