// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';
import type { ExecResult } from '../ci/lib/exec.ts';
import { fail, ok } from '../ci/lib/test-support.ts';
import { tempDir } from '../code-caps/test-support.ts';
import { CADDY_ROOT_CERTIFICATE, rootCertificate } from './proxy.ts';

// E19-S12: the root certificate of the reverse proxy, copied out of its container with `docker compose cp`.

const PEM = '-----BEGIN CERTIFICATE-----\nMIIBsmoke\n-----END CERTIFICATE-----\n';

/** A stack whose `compose cp` answers `result` and, when it succeeds, writes `content` where it was told to. */
function stub(result: ExecResult, content: string) {
  const directory = tempDir();
  const calls: string[][] = [];
  return {
    directory,
    calls,
    compose: (args: readonly string[]) => {
      calls.push([...args]);
      if (result.code === 0) {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: a path inside a temporary directory the test made
        fs.writeFileSync(args[2] ?? '', content);
      }
      return Promise.resolve(result);
    },
  };
}

test('the certificate is copied from the data volume of the caddy service into the directory of the stack, and returned as text', async () => {
  const probe = stub(ok(), PEM);
  expect(await rootCertificate(probe)).toBe(PEM);
  expect(probe.calls).toEqual([['cp', CADDY_ROOT_CERTIFICATE, path.join(probe.directory, 'caddy-root.crt')]]);
  expect(CADDY_ROOT_CERTIFICATE).toBe('caddy:/data/caddy/pki/authorities/local/root.crt');
});

test('while the proxy has not made the certificate yet there is none', async () => {
  const probe = stub(fail('Error: no such file or directory'), PEM);
  expect(await rootCertificate(probe)).toBeUndefined();
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test helper: a path inside a temporary directory the test made
  expect(fs.existsSync(path.join(probe.directory, 'caddy-root.crt'))).toBe(false);
});
