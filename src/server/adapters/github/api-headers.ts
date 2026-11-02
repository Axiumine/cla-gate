// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { packageVersion } from './package-version.ts';

/** The REST API version every request pins, so a change on GitHub's side cannot reshape an answer under us. */
const API_VERSION = '2022-11-28';

/**
 * The headers every request to api.github.com carries (E05-S04): `Accept`, `User-Agent: cla-gate/<package version>`
 * (GitHub requires one) and `X-GitHub-Api-Version`. Lower-case names, as Octokit merges them.
 * @throws Error when the package version cannot be read.
 */
export function apiHeaders(): Record<string, string> {
  return {
    accept: 'application/vnd.github+json',
    'user-agent': `cla-gate/${packageVersion()}`,
    'x-github-api-version': API_VERSION,
  };
}
