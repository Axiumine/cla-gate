// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { runOnTerminal, sandbox } from './test-support.ts';

// E19-S03: the prompts on a terminal. The script runs on a pseudo-terminal (util-linux `script`) with a stub psql, and
// each answer is typed when its prompt has appeared.

const OWNER_PROMPT = 'Password for cla_owner (at least 16 characters; empty keeps the password of an existing role): ';
const APP_PROMPT = 'Password for cla_app (at least 16 characters; empty keeps the password of an existing role): ';
const ADMIN_PROMPT = 'Administrator password for admin (empty if the server needs none): ';
const OWNER_ANSWER = 'typed-owner-password-1';
const APP_ANSWER = 'typed-app-password-22';
const ADMIN_ANSWER = 'typed-admin-password-3';
const ADMIN = { PGUSER: 'admin' };

test('the passwords of both roles and the administrator are asked for, twice for a role, and reach psql', async () => {
  const box = sandbox();
  const run = await runOnTerminal(
    box,
    [
      { after: OWNER_PROMPT, text: OWNER_ANSWER },
      { after: 'Repeat the password for cla_owner: ', text: OWNER_ANSWER },
      { after: APP_PROMPT, text: APP_ANSWER },
      { after: 'Repeat the password for cla_app: ', text: APP_ANSWER },
      { after: ADMIN_PROMPT, text: ADMIN_ANSWER },
    ],
    ADMIN,
  );
  expect(run.status).toBe(0);
  const seen = box.seen();
  expect([seen.get('CLA_OWNER_PASSWORD'), seen.get('CLA_APP_PASSWORD'), seen.get('PGPASSWORD')]).toEqual([
    OWNER_ANSWER,
    APP_ANSWER,
    ADMIN_ANSWER,
  ]);
});

test('echo is off: nothing that was typed appears on the terminal', async () => {
  const box = sandbox();
  const run = await runOnTerminal(
    box,
    [
      { after: OWNER_PROMPT, text: OWNER_ANSWER },
      { after: 'Repeat the password for cla_owner: ', text: OWNER_ANSWER },
      { after: APP_PROMPT, text: APP_ANSWER },
      { after: 'Repeat the password for cla_app: ', text: APP_ANSWER },
      { after: ADMIN_PROMPT, text: ADMIN_ANSWER },
    ],
    ADMIN,
  );
  expect(run.screen).toContain('Repeat the password for cla_owner: ');
  for (const typed of [OWNER_ANSWER, APP_ANSWER, ADMIN_ANSWER]) {
    expect(run.screen).not.toContain(typed);
  }
  expect(box.commandLines()).not.toContain(OWNER_ANSWER);
});

test('two entries that differ are refused with exit 2 and psql is not started', async () => {
  const box = sandbox();
  const run = await runOnTerminal(box, [
    { after: OWNER_PROMPT, text: OWNER_ANSWER },
    { after: 'Repeat the password for cla_owner: ', text: 'another-password-123' },
  ]);
  expect(run.status).toBe(2);
  expect(run.screen).toContain('provision-database: the two entries for the password of cla_owner differ');
  expect(box.psqlCalled()).toBe(false);
});

test('an empty answer keeps the password of an existing role: psql gets none', async () => {
  const box = sandbox();
  const run = await runOnTerminal(
    box,
    [
      { after: OWNER_PROMPT, text: '' },
      { after: APP_PROMPT, text: '' },
      { after: ADMIN_PROMPT, text: '' },
    ],
    ADMIN,
  );
  expect(run.status).toBe(0);
  const seen = box.seen();
  expect([seen.get('CLA_OWNER_PASSWORD'), seen.get('CLA_APP_PASSWORD'), seen.get('PGPASSWORD')]).toEqual([
    undefined,
    undefined,
    undefined,
  ]);
});

test('a role password that was supplied is not asked for again, and neither is one from a file variable', async () => {
  const box = sandbox();
  const run = await runOnTerminal(
    box,
    [
      { after: APP_PROMPT, text: APP_ANSWER },
      { after: 'Repeat the password for cla_app: ', text: APP_ANSWER },
      { after: ADMIN_PROMPT, text: '' },
    ],
    { ...ADMIN, CLA_OWNER_PASSWORD: '0123456789abcdef-owner' },
  );
  expect(run.status).toBe(0);
  expect(run.screen).not.toContain(OWNER_PROMPT);
  expect(box.seen().get('CLA_OWNER_PASSWORD')).toBe('0123456789abcdef-owner');
});

test.each([
  ['PGPASSWORD', '0123456789abcdef-admin'],
  ['PGPASSFILE', '/nonexistent/pgpass'],
  ['PGSERVICE', 'cla'],
])('the administrator is not asked for a password when %s is set', async (name, value) => {
  const box = sandbox();
  const run = await runOnTerminal(
    box,
    [
      { after: OWNER_PROMPT, text: '' },
      { after: APP_PROMPT, text: '' },
    ],
    { ...ADMIN, [name]: value },
  );
  expect(run.status).toBe(0);
  expect(run.screen).not.toContain('Administrator password');
});

test('the development role gets its own prompt, and a prompted password is held to 16 characters', async () => {
  const box = sandbox();
  const run = await runOnTerminal(
    box,
    [
      { after: 'Password for cla_dev ', text: 'too-short' },
      { after: 'Repeat the password for cla_dev: ', text: 'too-short' },
    ],
    {
      CLA_TEST_ROLE: 'cla_dev',
      CLA_OWNER_PASSWORD: '0123456789abcdef-owner',
      CLA_APP_PASSWORD: '0123456789abcdef-app',
    },
  );
  expect(run.status).toBe(2);
  expect(run.screen).toContain('provision-database: CLA_TEST_PASSWORD is shorter than 16 characters');
  expect(box.psqlCalled()).toBe(false);
});

test('an interrupt (Ctrl-C) while a password is asked for stops the script with 130 before psql is started', async () => {
  const box = sandbox();
  const run = await runOnTerminal(box, [{ after: OWNER_PROMPT, text: '\u0003' }]);
  expect(run.status).toBe(130);
  expect(box.psqlCalled()).toBe(false);
});
