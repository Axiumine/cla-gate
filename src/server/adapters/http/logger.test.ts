// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { captureLogs } from '../../test-support.ts';
import { openPgliteDatabase } from '../db/pglite.ts';
import { createLogger, REDACT_PATHS } from './logger.ts';

/** The matchers are typed `any`; as `unknown` they can sit in an object literal. */
const containing = (text: string): unknown => expect.stringContaining(text);
const matching = (pattern: RegExp): unknown => expect.stringMatching(pattern);

function logger(level: 'info' | 'error' = 'info') {
  const logs = captureLogs();
  return { log: createLogger({ logLevel: level }, logs.destination), logs };
}

test('nothing inside a headers object is logged, and credential names are redacted on their own', () => {
  const { log, logs } = logger();
  const headers = {
    authorization: 'Bearer sekrit-1',
    cookie: 'sid=sekrit-2',
    'set-cookie': ['sid=sekrit-3'],
    accept: 'text/html',
    'x-forwarded-for': '203.0.113.7',
  };
  log.info(
    { headers, req: { headers }, res: { headers }, nested: { headers }, 'x-api-key': 'sekrit-4' },
    'with headers',
  );
  expect(logs.text()).not.toMatch(/sekrit|text\/html|203\.0\.113\.7/);
  expect(logs.text()).toContain('[REDACTED]');
  expect(REDACT_PATHS).toContain('*.headers.*');
});

const SENSITIVE = {
  authorization: 'sekrit-a',
  Cookie: 'sekrit-b',
  'set-cookie': 'sekrit-c',
  'proxy-authorization': 'sekrit-d',
  'x-api-key': 'sekrit-e',
  Authorization: 'sekrit-f',
};

test.each([
  ['a request wrapper', { request: { raw: { headers: SENSITIVE } } }],
  ['unrelated containers', { a: { b: { headers: SENSITIVE } } }],
  ['unrelated containers three deep', { a: { b: { c: { headers: SENSITIVE } } } }],
  ['a header map at the top level', { headers: SENSITIVE }],
  ['a header map one level down', { reqHeaders: SENSITIVE, req: { headers: SENSITIVE } }],
  ['credential keys with no container', { 'proxy-authorization': 'sekrit-d', x: { authorization: 'sekrit-a' } }],
])('credentials are redacted in %s', (_case, shape) => {
  const { log, logs } = logger();
  log.info(shape, 'shape');
  expect(logs.text()).not.toContain('sekrit');
});

test('the request serializer keeps method and path, and drops client address, headers, body and query', () => {
  const { log, logs } = logger();
  const req = {
    method: 'POST',
    url: '/auth/callback?code=oauth-code&state=oauth-state',
    ip: '203.0.113.7',
    headers: { authorization: 'Bearer sekrit' },
    body: { name: 'Mallory' },
  };
  log.info({ req }, 'incoming request');
  expect(logs.lines()[0]?.['req']).toEqual({ method: 'POST', url: '/auth/callback' });
  for (const hidden of ['oauth-code', 'oauth-state', 'sekrit', 'Mallory', '203.0.113.7']) {
    expect(logs.text()).not.toContain(hidden);
  }
});

test('the response serializer logs the status code only', () => {
  const { log, logs } = logger();
  log.info({ res: { statusCode: 404, headers: { 'set-cookie': 'sid=sekrit' }, body: 'private' } }, 'request completed');
  expect(logs.lines()[0]?.['res']).toEqual({ statusCode: 404 });
});

test('the error serializer keeps the class, message, code and stack but not the row values a database error carries', () => {
  const { log, logs } = logger();
  const error = Object.assign(new Error('duplicate key value violates unique constraint "users_email_key"'), {
    code: '23505',
    detail: 'Key (email)=(victim@example.test) already exists.',
    parameters: ['victim@example.test'],
  });
  log.error({ err: error }, 'query failed');
  expect(logs.lines()[0]?.['err']).toEqual({
    type: 'Error',
    message: error.message,
    code: '23505',
    stack: containing('duplicate key value'),
  });
  expect(logs.text()).not.toContain('victim@example.test');
});

test('a database error is logged by code and names, never by message, detail or stack header', async () => {
  const db = await openPgliteDatabase();
  const { log, logs } = logger();
  const bad = 'jane.doe@example.com\n    at (victim@example.test)';
  const error: unknown = await sql`select ${bad}::bigint`.execute(db).catch((caught: unknown) => caught);
  await db.destroy();
  log.error({ err: error }, 'query failed');
  const logged = logs.lines()[0]?.['err'];
  expect(logged).toMatchObject({
    type: 'error',
    message: 'database error (details withheld)',
    code: '22P02',
    stack: containing('at '),
  });
  expect(logs.text()).not.toMatch(/jane\.doe|victim|invalid input syntax/);
});

test('a database error that names a constraint, table and column logs those names', async () => {
  const db = await openPgliteDatabase();
  const { log, logs } = logger();
  await sql`create table people (id int primary key, email text not null unique)`.execute(db);
  await sql`insert into people values (1, 'victim@example.test')`.execute(db);
  const duplicate: unknown = await sql`insert into people values (2, 'victim@example.test')`
    .execute(db)
    .catch((e: unknown) => e);
  const missing: unknown = await sql`insert into people values (3, null)`.execute(db).catch((e: unknown) => e);
  await db.destroy();
  log.error({ err: duplicate }, 'duplicate');
  log.error({ err: missing }, 'missing');
  expect(logs.lines().map((line) => line['err'])).toMatchObject([
    { code: '23505', constraint: 'people_email_key', table: 'people' },
    { code: '23502', column: 'email', table: 'people' },
  ]);
  expect(logs.text()).not.toContain('victim');
});

test('a system error with an uppercase code is not mistaken for a database error', () => {
  const { log, logs } = logger();
  log.error({ err: Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }) }, 'socket');
  expect(logs.lines()[0]?.['err']).toMatchObject({ message: 'write EPIPE', code: 'EPIPE' });
});

test('an error passed on its own is logged under err, as the database pool error handler does', () => {
  const { log, logs } = logger();
  const report = log.error.bind(log);
  report(new Error('pool died'));
  expect(logs.lines()[0]).toMatchObject({ level: 50, err: { type: 'Error', message: 'pool died' } });
});

test.each([
  ['a string', 'boom', { type: 'string' }],
  ['an object', { password: 'hunter2' }, { type: 'object' }],
])('a thrown %s is logged by type only', (_label, thrown, expected) => {
  const { log, logs } = logger();
  log.error({ err: thrown }, 'thrown');
  expect(logs.lines()[0]?.['err']).toEqual(expected);
  expect(logs.text()).not.toContain('hunter2');
});

test('an error without a code has no code field', () => {
  const { log, logs } = logger();
  log.error({ err: new TypeError('x') }, 'no code');
  expect(logs.lines()[0]?.['err']).toMatchObject({ type: 'TypeError', message: 'x' });
  expect(logs.lines()[0]?.['err']).not.toHaveProperty('code');
});

test('the level comes from the configuration and lines carry an ISO timestamp', () => {
  const { log, logs } = logger('error');
  log.info('hidden');
  log.error('shown');
  expect(logs.lines()).toHaveLength(1);
  expect(logs.lines()[0]).toMatchObject({ msg: 'shown', time: matching(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/) });
});
