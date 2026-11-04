// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { printable } from '../../code-caps/types.ts';
import { type Env, variable } from './env.ts';

export const VERSION_VARIABLE = 'INSTALL_TRIVY_VERSION';
export const SHA256_VARIABLE = 'INSTALL_TRIVY_SHA256';
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const RELEASES = 'https://github.com/aquasecurity/trivy/releases/download';

export interface Plan {
  readonly sha256: string;
  readonly url: string;
  readonly archive: string;
  readonly directory: string;
  readonly pathFile: string;
}

/** What to install and where, from the environment, or an error that says which setting is wrong (values escaped). */
export function planOf(env: Env): Plan {
  const temp = variable(env, 'RUNNER_TEMP');
  const pathFile = variable(env, 'GITHUB_PATH');
  const version = variable(env, VERSION_VARIABLE);
  const sha256 = variable(env, SHA256_VARIABLE);
  if (!path.isAbsolute(temp)) {
    throw new Error(`RUNNER_TEMP must be an absolute path, got "${printable(temp)}"`);
  }
  if (pathFile === '') {
    throw new Error('GITHUB_PATH is not set: this helper runs in a GitHub Actions step');
  }
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`${VERSION_VARIABLE} must be a release number such as 1.2.3, got "${printable(version)}"`);
  }
  if (!SHA256_PATTERN.test(sha256)) {
    throw new Error(`${SHA256_VARIABLE} must be 64 lowercase hex digits, got "${printable(sha256)}"`);
  }
  const archive = `trivy_${version}_Linux-64bit.tar.gz`;
  return {
    sha256,
    url: `${RELEASES}/v${version}/${archive}`,
    archive: path.join(temp, archive),
    directory: path.join(temp, 'trivy'),
    pathFile,
  };
}
