// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  CADDY_CONFIG,
  CADDY_IMAGE,
  CADDY_OWNER,
  isHttpsOrigin,
  isMountableFile,
  validateArguments,
} from './caddy-run.ts';
import { NAME_PATTERN } from './container-owner.ts';

const OPTIONS = {
  name: 'cla-caddy-7-1-abcd0123',
  image: CADDY_IMAGE,
  caddyfile: '/work/repo/docker/Caddyfile',
  user: '1001:121',
  origin: 'https://localhost',
};

test('the image is the official Caddy at a pinned minor version and a digest', () => {
  expect(CADDY_IMAGE).toMatch(/^caddy:2\.\d+@sha256:[0-9a-f]{64}$/);
});

test('every container the helper makes is named cla-caddy- and labelled cla-gate.ci=caddy', () => {
  expect(CADDY_OWNER).toEqual({ prefix: 'cla-caddy-', labelKey: 'cla-gate.ci', labelValue: 'caddy' });
  expect(NAME_PATTERN.test(OPTIONS.name)).toBe(true);
});

test('caddy validate runs once, with the label, no network, no published port and nothing writable but the tmpfs', () => {
  expect(validateArguments(OPTIONS)).toEqual([
    'run',
    '--rm',
    '--name',
    'cla-caddy-7-1-abcd0123',
    '--label',
    'cla-gate.ci=caddy',
    '--network',
    'none',
    '--read-only',
    '--tmpfs',
    '/tmp',
    '--cap-drop',
    'ALL',
    '--cap-add',
    'NET_BIND_SERVICE',
    '--security-opt',
    'no-new-privileges:true',
    '--user',
    '1001:121',
    '--env',
    'HOME=/tmp',
    '--env',
    'XDG_CONFIG_HOME=/tmp/config',
    '--env',
    'XDG_DATA_HOME=/tmp/data',
    '--env',
    'PUBLIC_BASE_URL=https://localhost',
    '--mount',
    'type=bind,src=/work/repo/docker/Caddyfile,dst=/etc/caddy/Caddyfile,ro',
    CADDY_IMAGE,
    'caddy',
    'validate',
    '--config',
    '/etc/caddy/Caddyfile',
    '--adapter',
    'caddyfile',
  ]);
});

test('the command never publishes a port, never mounts the Docker socket and never starts as root', () => {
  const args = validateArguments(OPTIONS);
  expect(args).not.toContain('--publish');
  expect(args).not.toContain('--privileged');
  expect(args.join(' ')).not.toContain('docker.sock');
  expect(args[args.indexOf('--user') + 1]).not.toMatch(/^0(:|$)/);
  expect(args.at(args.indexOf('--mount') + 1)).toContain(`dst=${CADDY_CONFIG},ro`);
});

test.each([
  ['https://localhost'],
  ['https://cla.example.com'],
  ['https://a'],
  ['https://sub-domain.example.org'],
  ['https://1.example.com'],
])('%s is an origin the proxy can serve', (origin) => {
  expect(isHttpsOrigin(origin)).toBe(true);
});

test.each([
  [''],
  ['https://'],
  ['http://cla.example.com'],
  ['https://cla.example.com/'],
  ['https://cla.example.com:8443'],
  ['https://user@cla.example.com'],
  ['https://CLA.example.com'],
  ['https://-cla.example.com'],
  ['https://cla.example.com-'],
  ['https://cla.example.com\nPUBLIC_BASE_URL=https://evil.example'],
  ['https://cla.example.com --privileged'],
  [`https://${'a'.repeat(254)}`],
])('%j is refused as an origin', (origin) => {
  expect(isHttpsOrigin(origin)).toBe(false);
});

test.each([
  ['/work/repo/docker/Caddyfile', true],
  ['/work/with space/Caddyfile', true],
  ['/work/with:colon/Caddyfile', true],
  ['docker/Caddyfile', false],
  ['/work/a,b/Caddyfile', false],
  ['/work/a\u0000b/Caddyfile', false],
  ['/work/a\nb/Caddyfile', false],
  ['', false],
])('%j as the source of a bind mount: %s', (file, mountable) => {
  expect(isMountableFile(file)).toBe(mountable);
});
