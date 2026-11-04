// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { labelOf, type Owner } from './container-owner.ts';

// E19-S05: the docker command line of the `caddy` CI job, which checks docker/Caddyfile with the image the compose
// profile `tls` runs.

/**
 * The official Caddy image: the tag documents the minor version, the digest pins the image. It is the one docker-compose.yml
 * runs (scripts/compose/caddy-service.test.ts keeps the two equal), so the file that CI validates is checked by the Caddy
 * that will read it. Bump both together.
 */
export const CADDY_IMAGE = 'caddy:2.11@sha256:36c24ad91a7ff7bc4c87fe22bfa8df3c4b18da0773d73fc12ee2c52b98c0bb7e';

/** `cla-caddy-<run id>-<attempt>-<random>`, labelled `cla-gate.ci=caddy`; the cleanup step removes nothing else. */
export const CADDY_OWNER: Owner = { prefix: 'cla-caddy-', labelKey: 'cla-gate.ci', labelValue: 'caddy' };

/** Where the image reads its configuration from, and where the Caddyfile is mounted. */
export const CADDY_CONFIG = '/etc/caddy/Caddyfile';

const SCHEME = 'https://';
const HOST = /^[a-z0-9][a-z0-9.-]*$/;
const MAX_HOST_LENGTH = 253;

/**
 * True when `origin` is what PUBLIC_BASE_URL may be for the proxy: `https://` and a host name, nothing else (no path, no
 * port, no userinfo, no upper case, no label that starts or ends the name with a dot or a hyphen). A bare `https://` is a
 * valid Caddy site address that matches every host, which is why the host part is required.
 */
export function isHttpsOrigin(origin: string): boolean {
  const host = origin.slice(SCHEME.length);
  return origin.startsWith(SCHEME) && host.length <= MAX_HOST_LENGTH && HOST.test(host) && !/[.-]$/.test(host);
}

export interface ValidateOptions {
  readonly name: string;
  readonly image: string;
  /** Absolute path of docker/Caddyfile on the host. */
  readonly caddyfile: string;
  /** `uid:gid` of the runner user: the file is readable by its owner whatever the mode, and nothing runs as root. */
  readonly user: string;
  /** The value of PUBLIC_BASE_URL for this run: it passed {@link isHttpsOrigin}. */
  readonly origin: string;
}

/** True when `file` can be the source of `--mount type=bind,src=<file>,...`: absolute, no comma, no control character. */
export function isMountableFile(file: string): boolean {
  return file.startsWith('/') && !file.includes(',') && !/\p{Cc}/u.test(file);
}

/**
 * `docker run` for `caddy validate` on the mounted Caddyfile. `--network none` and no `--publish`: validation loads and
 * provisions the configuration without listening or contacting anyone (no certificate is requested). Every capability is
 * dropped except NET_BIND_SERVICE, because the image's binary carries that file capability and `no-new-privileges` makes the
 * kernel refuse to start a binary whose capability is not in the container's set. The container runs as the runner user,
 * with its state under the tmpfs. `--mount` (not `--volume`) refuses a missing source instead of creating a directory there.
 * The origin has no secret in it, so it may appear in the argument list.
 */
export function validateArguments(options: ValidateOptions): string[] {
  return [
    'run',
    '--rm',
    '--name',
    options.name,
    '--label',
    labelOf(CADDY_OWNER),
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
    options.user,
    // An arbitrary uid has no home directory in the image, and the image's own state directories belong to root.
    '--env',
    'HOME=/tmp',
    '--env',
    'XDG_CONFIG_HOME=/tmp/config',
    '--env',
    'XDG_DATA_HOME=/tmp/data',
    '--env',
    `PUBLIC_BASE_URL=${options.origin}`,
    '--mount',
    `type=bind,src=${options.caddyfile},dst=${CADDY_CONFIG},ro`,
    options.image,
    'caddy',
    'validate',
    '--config',
    CADDY_CONFIG,
    '--adapter',
    'caddyfile',
  ];
}
