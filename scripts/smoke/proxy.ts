// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { readText } from './files.ts';
import type { Stack } from './stack-types.ts';

// E19-S12: the root certificate of the reverse proxy of the `tls` profile. For `https://localhost` Caddy signs with an authority
// of its own (docker/Caddyfile, skip_install_trust keeps it out of the container's trust store), and the scenario trusts that
// authority and no other.

/** Where Caddy keeps the root certificate of its internal authority: in the data volume (`/data`), under `caddy/pki`. */
export const CADDY_ROOT_CERTIFICATE = 'caddy:/data/caddy/pki/authorities/local/root.crt';

/**
 * Copies the root certificate out of the running `caddy` container, with `docker compose cp`, and returns its PEM. Undefined
 * while the proxy has not made it yet (it creates the authority when it loads its configuration, a moment after it starts).
 */
export async function rootCertificate(stack: Pick<Stack, 'compose' | 'directory'>): Promise<string | undefined> {
  const target = path.join(stack.directory, 'caddy-root.crt');
  const copied = await stack.compose(['cp', CADDY_ROOT_CERTIFICATE, target]);
  return copied.code === 0 ? readText(target) : undefined;
}
