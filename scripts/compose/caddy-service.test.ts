// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { expect, test } from 'vitest';
import { CADDY_CONFIG, CADDY_IMAGE } from '../ci/lib/caddy-run.ts';
import { readText } from '../ci/lib/test-support.ts';
import { ROOT, readCompose, serviceNamed, withDefault, withOptionalPrefix } from './test-support.ts';

// E19-S05: the optional reverse proxy of the operator stack, read from the parsed compose file. The wire behaviour of the proxy
// is shown against the real image by the manual run recorded in docs/epics/E19.md and automated by the TLS scenario of E19-S12;
// `yarn ci:caddy validate` (the `caddy` CI job) checks the Caddyfile with the pinned image.

const compose = readCompose();
const caddy = serviceNamed(compose, 'caddy');
const app = serviceNamed(compose, 'app');

test('the proxy is in the profile tls and nowhere else, so the default `docker compose up` never starts it', () => {
  expect(caddy.profiles).toEqual(['tls']);
  expect(
    Object.entries(compose.services)
      .filter(([, service]) => service.profiles === undefined)
      .map(([name]) => name),
  ).toEqual(['postgres', 'migrate', 'app']);
});

test('no other service waits for the proxy or needs it, and it needs none: it starts and stops on its own', () => {
  expect(caddy.depends_on).toBeUndefined();
  for (const name of ['postgres', 'migrate', 'app']) {
    expect(Object.keys(serviceNamed(compose, name).depends_on ?? {})).not.toContain('caddy');
  }
});

test('the image is the official Caddy at a pinned minor version and digest, the one the CI job validates the Caddyfile with', () => {
  expect(caddy.image).toBe(CADDY_IMAGE);
  expect(caddy.image).toMatch(/^caddy:2\.\d+@sha256:[0-9a-f]{64}$/);
  expect(caddy.build).toBeUndefined();
});

test('it publishes 80/tcp, 443/tcp and 443/udp, each host side a variable with the public port as its default', () => {
  const bind = withOptionalPrefix('CADDY_BIND_ADDRESS');
  expect(caddy.ports).toEqual([
    `${bind}${withDefault('CADDY_HTTP_PORT', '80')}:80`,
    `${bind}${withDefault('CADDY_HTTPS_PORT', '443')}:443`,
    `${bind}${withDefault('CADDY_HTTPS_PORT', '443')}:443/udp`,
  ]);
});

test('it keeps its certificates in two named volumes and reads the Caddyfile read-only from where the image looks for it', () => {
  expect(caddy.volumes).toEqual([`./docker/Caddyfile:${CADDY_CONFIG}:ro`, 'caddy-data:/data', 'caddy-config:/config']);
  expect(Object.keys(compose.volumes)).toEqual(expect.arrayContaining(['caddy-data', 'caddy-config']));
  expect(caddy.command).toBeUndefined();
});

test('it runs read-only with the two volumes and /tmp as its only writable places, one capability and no privilege gain', () => {
  expect(caddy.read_only).toBe(true);
  expect(caddy.tmpfs).toEqual(['/tmp']);
  expect(caddy.cap_drop).toEqual(['ALL']);
  expect(caddy.cap_add).toEqual(['NET_BIND_SERVICE']);
  expect(caddy.security_opt).toEqual(['no-new-privileges:true']);
});

test('it restarts unless stopped, so the stack and the certificate survive a reboot', () => {
  expect(caddy.restart).toBe('unless-stopped');
});

test('it is on the default network only, so it has no route to PostgreSQL, which is on the internal one', () => {
  expect(caddy.networks).toEqual(['default']);
  expect(compose.networks['backend']).toEqual({ internal: true });
  expect(serviceNamed(compose, 'postgres').networks).not.toContain('default');
});

test('it gets the public origin and the contact address, with empty defaults, and holds no secret', () => {
  expect(caddy.environment).toEqual({
    PUBLIC_BASE_URL: withDefault('PUBLIC_BASE_URL', ''),
    ACME_EMAIL: withDefault('ACME_EMAIL', ''),
  });
  expect(caddy.secrets).toBeUndefined();
});

test('the upstream of the Caddyfile is the app service on the port that the app listens on inside its container', () => {
  const upstream = /^reverse_proxy (\S+)$/m.exec(caddyfileCode());
  expect(upstream?.[1]).toBe('app:3000');
  expect(Object.keys(compose.services)).toContain('app');
  expect(app.ports?.every((port) => port.endsWith(':3000'))).toBe(true);
});

// ------------------------------------------------------------------------------------------------- docker/Caddyfile

const CADDYFILE = readText(path.join(ROOT, 'docker/Caddyfile'));

/** The lines of the Caddyfile that are not comments or blank, trimmed. */
function caddyfileLines(): string[] {
  return CADDYFILE.split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

function caddyfileCode(): string {
  return caddyfileLines().join('\n');
}

test('the Caddyfile carries the licence header', () => {
  expect(
    CADDYFILE.startsWith('# SPDX-License-Identifier: AGPL-3.0-only\n# Copyright (C) 2026 Giovanni Manzoni\n'),
  ).toBe(true);
});

test('the Caddyfile is the contact address, then one site at PUBLIC_BASE_URL that compresses, hides the server and proxies', () => {
  expect(caddyfileLines()).toEqual([
    '{',
    'email "{$ACME_EMAIL}"',
    'skip_install_trust',
    '}',
    '{$PUBLIC_BASE_URL} {',
    'encode zstd gzip',
    'header -Server',
    'reverse_proxy app:3000',
    '}',
  ]);
});

test('the contact address is quoted, so that an empty ACME_EMAIL is an empty argument and not a missing one', () => {
  expect(caddyfileLines()).toContain('email "{$ACME_EMAIL}"');
  expect(caddyfileLines()).not.toContain('email {$ACME_EMAIL}');
});

test.each([
  [
    'trusted_proxies',
    'Caddy trusts no upstream proxy, so it replaces X-Forwarded-For, X-Forwarded-Proto and X-Forwarded-Host',
  ],
  ['header_up', 'no request header is rewritten by hand, the forwarded ones included'],
  ['request_body', 'a request body is not limited below the 25 MiB of a GitHub webhook, nor changed'],
  ['max_size', 'a request body is not limited below the 25 MiB of a GitHub webhook'],
  ['Strict-Transport-Security', 'the application sends the only HSTS header'],
  ['servers', 'no server option such as trusted_proxies or timeouts is set here'],
  ['auto_https', 'automatic HTTPS and the redirect from HTTP stay on'],
  [
    'local_certs',
    'a public name gets a public certificate; only localhost gets one from the internal CA, by Caddy itself',
  ],
  ['acme_ca', 'the default certificate authorities stay'],
  ['log', 'the proxy writes no access log: the application logs its own requests'],
  ['redir', 'the redirect from HTTP is the automatic one'],
  ['tls', 'the certificate comes from the automatic management, with no site-level override'],
])('the Caddyfile has no %s: %s', (word) => {
  const words = caddyfileCode().split(/[\s{}]+/);
  expect(words).not.toContain(word);
});

test('the Caddyfile never names a secret, a token or a password', () => {
  expect(CADDYFILE).not.toMatch(/secret|token|password|authorization|cookie/i);
});
