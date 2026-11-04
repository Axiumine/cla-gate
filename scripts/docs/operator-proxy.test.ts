// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { WEBHOOK_BODY_LIMIT } from '../../src/server/adapters/http/limits.ts';
import { RATE_LIMITS } from '../../src/server/adapters/http/rate-limit.ts';
import { parseTrustProxy } from '../../src/server/config/trust-proxy.ts';
import { readText } from '../ci/lib/test-support.ts';
import { assignments, readCompose, STACK_SUBNET, serviceNamed, withDefault } from '../compose/test-support.ts';
import { codeBlocks, guide, ROOT, sectionsOf, tablesOf } from './test-support.ts';

// docs/operations/reverse-proxy.md against the code and the stack (E19-S09): the nginx example does what the page says it does,
// every value `TRUST_PROXY` is documented to accept is accepted, and the numbers and defaults it quotes are the real ones.

const proxy = guide('reverse-proxy');
const MIB = 1024 * 1024;
// eslint-disable-next-line sonarjs/no-hardcoded-ip -- the address of the proxy in the example of the guide, written as data
const PROXY = '10.0.0.9';
// eslint-disable-next-line sonarjs/no-hardcoded-ip -- a range with the prefix /0, written as data: the parser must refuse it
const EVERYTHING = '10.0.0.0/0';

/** The directives of an nginx block as `[name, argument text]`, comments removed. */
function directives(config: string): [string, string][] {
  const code = config
    .split('\n')
    .map((line) => (line.includes('#') ? line.slice(0, line.indexOf('#')) : line).trim())
    .join(' ');
  return code
    .replaceAll(/[{}]/g, ';')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement !== '')
    .map((statement): [string, string] => {
      const [name = '', ...argument] = statement.split(/\s+/);
      return [name, argument.join(' ')];
    });
}

const [nginx = { language: 'nginx', text: '' }] = codeBlocks(proxy, 'nginx');
const settings = directives(nginx.text);
const headers = new Map(
  settings
    .filter(([name]) => name === 'proxy_set_header')
    .map(([, argument]): [string, string] => {
      const [header = '', ...value] = argument.split(/\s+/);
      return [header, value.join(' ')];
    }),
);
const argumentOf = (directive: string) => settings.find(([name]) => name === directive)?.[1];

test('the nginx example overwrites the forwarded headers with what nginx saw, and drops the Forwarded header', () => {
  expect(Object.fromEntries(headers)).toMatchObject({
    Host: '$host',
    'X-Forwarded-For': '$remote_addr',
    'X-Forwarded-Proto': '$scheme',
    'X-Forwarded-Host': '$host',
    Forwarded: '""',
  });
});

test('the nginx example never appends to what a client sent and never adds a second HSTS header', () => {
  expect([...headers.values()].join(' ')).not.toContain('$proxy_add_x_forwarded_for');
  expect(settings.map(([name]) => name)).not.toContain('add_header');
  expect(proxy).toMatch(/do not add `add_header Strict-Transport-Security`/);
});

test('the nginx body limit lets the application be the one that refuses a delivery, and the upstream is the published port', () => {
  const limit = argumentOf('client_max_body_size') ?? '';
  expect(limit).toMatch(/^\d+m$/);
  expect(Number.parseInt(limit, 10) * MIB).toBeGreaterThanOrEqual(25 * MIB);
  expect(Number.parseInt(limit, 10) * MIB).toBeGreaterThan(WEBHOOK_BODY_LIMIT);
  expect(proxy).toContain('above 10 MiB');
  expect(WEBHOOK_BODY_LIMIT).toBe(10 * MIB);
  const ports = serviceNamed(readCompose(), 'app').ports ?? [];
  expect(ports).toEqual([`${withDefault('BIND_ADDRESS', '127.0.0.1')}:${withDefault('PORT', '3000')}:3000`]);
  expect(argumentOf('proxy_pass')).toBe('http://127.0.0.1:3000');
});

test('the nginx example redirects port 80 and terminates TLS on 443 with modern protocols only', () => {
  const listens = settings.filter(([name]) => name === 'listen').map(([, argument]) => argument);
  expect(listens).toEqual(expect.arrayContaining(['80', '443 ssl']));
  expect(argumentOf('ssl_protocols')).toBe('TLSv1.2 TLSv1.3');
  expect(argumentOf('return')).toBe('301 https://$host$request_uri');
});

const [accepted] = sectionsOf(proxy, 2).filter((section) => section.heading === 'What `TRUST_PROXY` accepts');
const [forms] = tablesOf(accepted?.body ?? '');

test('every value the TRUST_PROXY table documents is accepted by the parser', () => {
  const values = (forms?.rows ?? [])
    .flatMap((cells) => [...(cells[0] ?? '').matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? ''))
    .flatMap((cell) => (cell.includes(' or ') ? cell.split(' or ') : [cell]))
    .filter((value) => value !== '...');
  expect(values).toEqual(expect.arrayContaining(['false', 'true', '1', PROXY, '10.0.0.0/24,192.0.2.7']));
  expect(values.filter((value) => parseTrustProxy(value) === undefined)).toEqual([]);
  expect(parseTrustProxy('false')).toBe(false);
  expect(parseTrustProxy('true')).toBe(true);
  expect(parseTrustProxy('2')).toBe(2);
});

test('what the page says is refused is refused: a typo, an empty entry and a range with the prefix /0', () => {
  expect(parseTrustProxy('tru')).toBeUndefined();
  expect(parseTrustProxy(EVERYTHING)).toBeUndefined();
  expect(parseTrustProxy('10.0.0.1,,10.0.0.2')).toBeUndefined();
  expect(proxy).toMatch(/Anything else is a start-up error naming `TRUST_PROXY`/);
  expect(proxy).toMatch(/a range with the prefix `\/0`/);
});

test('the examples for another host parse and name one proxy', () => {
  expect(parseTrustProxy(PROXY)).toEqual([PROXY]);
  expect(proxy).toContain('BIND_ADDRESS=10.0.0.5');
  expect(proxy).toContain(`TRUST_PROXY=${PROXY}`);
});

test('the stack trusts its own subnet: the default of TRUST_PROXY, of EDGE_SUBNET and the page agree', () => {
  const app = serviceNamed(readCompose(), 'app');
  expect(app.environment?.['TRUST_PROXY']).toBe(withDefault('TRUST_PROXY', STACK_SUBNET));
  const subnets = Object.values(readCompose().networks).flatMap(
    (network) => network.ipam?.config.map((entry) => entry.subnet) ?? [],
  );
  expect(subnets).toEqual([withDefault('EDGE_SUBNET', STACK_SUBNET)]);
  expect(proxy).toContain(`\`${STACK_SUBNET}\``);
  const dotenv = assignments(readText(path.join(ROOT, '.env.example')));
  expect(dotenv.get('TRUST_PROXY')).toBe(STACK_SUBNET);
  expect(dotenv.get('EDGE_SUBNET')).toBe(STACK_SUBNET);
});

test('the rate limits it quotes are the budgets of the server', () => {
  expect(proxy).toContain(`${RATE_LIMITS.global} requests a minute`);
  expect(proxy).toContain(`${RATE_LIMITS.login} login starts a minute`);
  expect(proxy).toContain('trust_proxy_suspected');
});

test('the tls profile publishes 80 and 443 with the variables the page names, and mounts the two volumes it names', () => {
  const caddy = serviceNamed(readCompose(), 'caddy');
  const dotenv = assignments(readText(path.join(ROOT, '.env.example')));
  expect(caddy.ports).toHaveLength(3);
  for (const variable of ['CADDY_BIND_ADDRESS', 'CADDY_HTTP_PORT', 'CADDY_HTTPS_PORT', 'ACME_EMAIL']) {
    expect(proxy).toContain(variable);
    expect(dotenv.has(variable)).toBe(true);
  }
  expect(caddy.volumes?.join(' ')).toContain('caddy-data:/data');
  expect(caddy.volumes?.join(' ')).toContain('caddy-config:/config');
  expect(proxy).toContain('`caddy-data`');
  expect(proxy).toContain('`caddy-config`');
});

test('the page gives the four verification steps, with the header the server sets', () => {
  const [verify] = sectionsOf(proxy, 3).filter((section) => section.heading === 'Verify the setting');
  expect(verify?.body.match(/^\d\. /gm)).toHaveLength(4);
  expect(verify?.body).toContain('x-ratelimit-remaining');
  expect(verify?.body).toContain('/healthz');
  expect(forms?.separator).toBe('|---|---|');
});
