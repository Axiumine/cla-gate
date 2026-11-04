// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { WEBHOOK_BODY_LIMIT } from '../../src/server/adapters/http/limits.ts';
import { DEAD_LETTER_QUEUE, QUEUE_DEFINITIONS, queueSettings } from '../../src/server/adapters/jobs/queues.ts';
import { ConfigError } from '../../src/server/config/config-error.ts';
import { loadConfig } from '../../src/server/config/env.ts';
import { resolveSecretFiles } from '../../src/server/config/secret-files.ts';
import { RETRY_LIMIT } from '../../src/server/domain/job-retry.ts';
import { readText } from '../ci/lib/test-support.ts';
import { withDefault } from '../compose/test-support.ts';
import { codeBlocks, GUIDES, guide, placeholder, ROOT, sectionsOf, serverSource, tablesOf } from './test-support.ts';

// docs/operations/troubleshooting.md against the server (E19-S09): the start-up messages are the ones the configuration
// prints, the webhook answers are the codes and statuses of the webhook route, and the numbers of the job policy are the
// queue settings.

const troubleshooting = guide('troubleshooting');
const sections = sectionsOf(troubleshooting, 2);
const sectionNamed = (start: string) => sections.find((section) => section.heading.startsWith(start))?.body ?? '';
const DATABASE_URL = 'postgres://cla_app:made-up@db.example.test:5432/cla';
const BASE = { DATABASE_URL, NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://cla.example.com' };

/** The lines a start-up refusal prints for an environment. */
function linesFor(env: Record<string, string>): readonly string[] {
  try {
    loadConfig({ ...BASE, ...env });
  } catch (error) {
    if (error instanceof ConfigError) {
      return error.lines;
    }
    throw error;
  }
  return [];
}

const [startupLines = { language: 'text', text: '' }] = codeBlocks(troubleshooting, 'text');
const documented = startupLines.text.split('\n');

test('the page has the symptoms the story lists, each with a cause and a fix', () => {
  const headings = sections.map((section) => section.heading);
  expect(headings).toEqual([
    'The server stops at start-up with a configuration error',
    '`migrate` fails',
    '`/readyz` answers 503',
    'People sign in at GitHub and are asked to sign in again',
    'Deliveries fail in GitHub\'s "Recent Deliveries"',
    'A check stays "in progress"',
    'Every user is rate limited',
    'The certificate is not issued',
    '`/setup` does not work',
  ]);
  for (const section of sections.filter((entry) => !entry.heading.startsWith('`/setup`'))) {
    expect(section.body, section.heading).toMatch(/\*\*Cause( and fix)?\.\*\*/);
  }
});

test('the start-up lines on the page are the lines the configuration prints, word for word', () => {
  expect(documented).toHaveLength(5);
  expect(linesFor({ PUBLIC_BASE_URL: 'http://cla.example.com/path' })).toContain(documented[0]);
  expect(linesFor({})).toContain(documented[1]);
  expect(linesFor({ GITHUB_APP_ID: '1234' })).toContain(documented[2]);
  expect(
    new ConfigError(resolveSecretFiles({ GITHUB_APP_PRIVATE_KEY_FILE: '/run/secrets/github_app_private_key' }).issues)
      .lines,
  ).toEqual([documented[3]]);
  expect(
    new ConfigError(
      resolveSecretFiles({ SESSION_SECRET: 'a', SESSION_SECRET_FILE: '/run/secrets/session_secret' }).issues,
    ).lines,
  ).toEqual([documented[4]]);
});

test('the database line is printed after five tries two seconds apart, and names the code of the driver', () => {
  const source = readText(path.join(ROOT, 'src/server/boot-database.ts'));
  expect(source).toContain('const ATTEMPTS = 5;');
  expect(source).toContain('const BACKOFF_MS = 2000;');
  expect(source).toContain(
    `database: cannot connect (${placeholder('code')}); check DATABASE_URL and that the database is up`,
  );
  expect(sectionNamed('The server stops')).toContain(
    'database: cannot connect (ECONNREFUSED); check DATABASE_URL and that the database is up',
  );
  expect(sectionNamed('The server stops')).toMatch(/after five tries two seconds apart/);
});

test('a secret file is limited to 64 KiB and a secret may not be given twice, as the cause says', () => {
  expect(readText(path.join(ROOT, 'src/server/config/secret-files.ts'))).toContain('64 * 1024');
  expect(sectionNamed('The server stops')).toContain('larger than 64 KiB');
});

test('/readyz is 503 with a fixed body when the database or the queue does not answer in two seconds, and /healthz does not look at either', () => {
  const app = readText(path.join(ROOT, 'src/server/app.ts'));
  const health = readText(path.join(ROOT, 'src/server/adapters/http/health.ts'));
  expect(app).toContain('DEFAULT_READINESS_TIMEOUT_MS = 2000');
  expect(health).toContain('select 1');
  expect(health).toContain("reply.code(503).send({ status: 'unavailable' })");
  expect(sectionNamed('`/readyz`')).toContain('{"status":"unavailable"}');
  expect(sectionNamed('`/readyz`')).toContain('each within two seconds');
  expect(sectionNamed('`/readyz`')).toContain('`/healthz` stays `200`');
  const probe = readText(path.join(ROOT, 'src/server/adapters/http/health-probe.ts'));
  expect(readText(path.join(ROOT, 'Dockerfile'))).toContain('CMD ["node", "dist/server/healthcheck.js"]');
  expect(probe).toContain(`\`http://127.0.0.1:${placeholder('options.port')}/healthz\``);
});

const [answers] = tablesOf(sectionNamed('Deliveries fail'));
const rows = (answers?.rows ?? []).map(([response = '', cause = '', fix = '']) => ({ response, cause, fix }));
/** The status of `new AppError(<status>, '<code>'`, read from the source of the server. */
function statusOf(source: string, code: string): string | undefined {
  const at = source.indexOf(`, '${code}'`);
  const call = 'new AppError(';
  return at >= call.length + 3 && source.slice(at - 3 - call.length, at - 3) === call
    ? source.slice(at - 3, at)
    : undefined;
}

test('each webhook answer on the page has the status the route gives it', () => {
  const source = serverSource();
  const pairs = rows.flatMap((row) =>
    [...row.response.matchAll(/`(\d{3}) (webhook_[a-z_]+)`/g)].map((match) => [match[1], match[2]]),
  );
  expect(pairs.map(([, code]) => code)).toEqual([
    'webhook_signature_invalid',
    'webhook_wrong_app',
    'webhook_unsupported_media_type',
    'webhook_payload_too_large',
    'webhook_throttled',
    'webhook_enqueue_failed',
    'webhook_timeout',
  ]);
  for (const [status, code] of pairs) {
    expect(statusOf(source, code ?? ''), code).toBe(status);
  }
});

test('the 202 for an organisation that is not admitted is the answer the route gives, with the reason the page quotes', () => {
  const source = serverSource();
  expect(rows.some((row) => row.response.includes('`202`') && row.response.includes('installation_not_admitted'))).toBe(
    true,
  );
  expect(source).toContain("body: { status: 'ignored', reason: admitted.reason }");
  expect(source).toContain('installation_not_admitted');
});

test('the body limits: the application refuses above 10 MiB, and the page says it is the 1 MiB default of nginx that comes first', () => {
  const row = rows.find((entry) => entry.response.includes('webhook_payload_too_large'));
  expect(WEBHOOK_BODY_LIMIT).toBe(10 * 1024 * 1024);
  expect(row?.cause).toContain('10 MiB');
  expect(row?.cause).toContain('1 MiB');
  expect(row?.fix).toContain('client_max_body_size 25m;');
});

test('the origin and CSRF refusals the sign-in entry talks about exist, and the callback URL is the one the setup registers', () => {
  const source = serverSource();
  expect(source).toContain("new AppError(403, 'origin_not_allowed')");
  expect(source).toContain('/api/auth/callback');
  expect(sectionNamed('People sign in')).toContain('`PUBLIC_BASE_URL` plus `/api/auth/callback`');
  expect(sectionNamed('People sign in')).toContain('__Host-cla_session');
  expect(source).toContain('__Host-cla_session');
});

test('the job policy it quotes is the queue policy: five retries, 30 seconds doubling, 300 seconds, the dead-letter queue, /recheck', () => {
  const settings = queueSettings(QUEUE_DEFINITIONS[0]);
  const body = sectionNamed('A check stays');
  expect(RETRY_LIMIT).toBe(5);
  expect(settings).toMatchObject({
    retryLimit: 5,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 300,
    deadLetter: DEAD_LETTER_QUEUE,
  });
  expect(body).toContain('retried five times (six runs in all)');
  expect(body).toContain('after 30 seconds and each next one after twice as long');
  expect(body).toContain('300-second expiry');
  expect(body).toContain(`\`${DEAD_LETTER_QUEUE}\``);
  expect(body).toContain('`/recheck`');
  expect(body).toContain('`dead_letter_unhandled`');
});

test('the sweep it relies on is on by default and re-queues evaluations that stayed in progress for 30 minutes', () => {
  const body = sectionNamed('A check stays');
  const reaper = readText(path.join(ROOT, 'src/server/services/sweep/reaper.ts'));
  expect(body).toContain('`SWEEP_INTERVAL_MINUTES` is 30 by default and 0 turns it off');
  expect(reaper).toContain('more than 30 minutes');
  expect(readText(path.join(ROOT, 'docker-compose.yml'))).toContain(
    `SWEEP_INTERVAL_MINUTES: ${withDefault('SWEEP_INTERVAL_MINUTES', '30')}`,
  );
});

test('the log events the page names exist in the server', () => {
  const source = serverSource();
  const events = [
    'trust_proxy_suspected',
    'webhook.enqueue_failed',
    'github.rate_limited',
    'github.app_keys_refused',
    'members_permission_missing',
    'dead_letter_unhandled',
  ];
  expect(events.filter((event) => !troubleshooting.includes(event))).toEqual([]);
  expect(events.filter((event) => !source.includes(event))).toEqual([]);
});

test('the setup page is locked after five wrong tries a minute, and a setup that is not in setup mode is a 404', () => {
  const source = serverSource();
  const body = sectionNamed('`/setup`');
  expect(body).toContain('More than five wrong tries in a minute');
  expect(source).toContain("new AppError(429, 'too_many_requests')");
  expect(body).toContain('`404`');
  expect(body).toContain('install -m 0444 /dev/null secrets/<file>');
});

test('every guide it links to is one of the eight', () => {
  const targets = [...troubleshooting.matchAll(/\]\(([a-z-]+)\.md/g)].map((match) => match[1]);
  expect(targets.filter((target) => !GUIDES.some((name) => name === target))).toEqual([]);
  expect(new Set(targets).size).toBeGreaterThanOrEqual(4);
});
