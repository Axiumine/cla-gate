// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import path from 'node:path';
import { labelOf, type Owner } from './container-owner.ts';

// E20-S06: the docker command line of the `e2e` CI job's Playwright container.

/** The environment variable that names the image. The workflow sets it (job-level `env`), so the pin test can read it there. */
export const IMAGE_VARIABLE = 'E2E_IMAGE';

/**
 * The only image the helper starts: Microsoft's Playwright image, a Playwright version, the Ubuntu noble variant, and a
 * digest. The tag says which Playwright the browsers belong to; the digest keeps a re-pushed tag from changing the
 * rendering under a committed baseline. Group 1 is the version.
 */
export const IMAGE_PATTERN = /^mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-noble@sha256:[0-9a-f]{64}$/;

/** `cla-e2e-<run id>-<attempt>-<random>`, labelled `cla-gate.ci=e2e`; the cleanup step removes nothing else. */
export const E2E_OWNER: Owner = { prefix: 'cla-e2e-', labelKey: 'cla-gate.ci', labelValue: 'e2e' };

/** Where the repository is mounted inside the container. */
const WORKDIR = '/work';

export interface RunOptions {
  readonly name: string;
  readonly image: string;
  /** Absolute path of the repository on the host. */
  readonly workspace: string;
  /** `uid:gid` of the runner user: files the container writes into the workspace must stay removable by that user. */
  readonly user: string;
  /** The `CI` variable of the job, passed on so that the run behaves as in CI (`forbidOnly`). */
  readonly ci: string;
}

/** True when `workspace` can be the host side of `--volume <host>:<container>`: absolute, no colon, no control character. */
export function isMountable(workspace: string): boolean {
  return path.isAbsolute(workspace) && !workspace.includes(':') && !/\p{Cc}/u.test(workspace);
}

/**
 * `docker run` for one command in the pinned image. `--init` reaps the browser processes, `--ipc=host` keeps Chromium
 * from running out of shared memory, and `--network host` lets the container reach the database that
 * `yarn ci:postgres start` published on the host's loopback (the application and the browser then listen there on a
 * random port above 32768). The command runs as the runner user, never as root. DATABASE_URL has no value here: docker
 * takes it from its own environment, so the password never shows in the process list.
 */
export function runArguments(options: RunOptions, command: readonly string[]): string[] {
  return [
    'run',
    '--rm',
    '--init',
    '--ipc=host',
    '--network',
    'host',
    '--name',
    options.name,
    '--label',
    labelOf(E2E_OWNER),
    '--user',
    options.user,
    '--volume',
    `${options.workspace}:${WORKDIR}`,
    '--workdir',
    WORKDIR,
    '--env',
    'E2E_CONTAINER=1',
    // The image runs the repository's Node with Yarn 1, which refuses a project that names another package manager;
    // it is used as a script runner only (corepack is not bundled with Node 25 and later).
    '--env',
    'SKIP_YARN_COREPACK_CHECK=1',
    // An arbitrary uid has no home directory in the image.
    '--env',
    'HOME=/tmp',
    ...(options.ci === '' ? [] : ['--env', `CI=${options.ci}`]),
    '--env',
    'DATABASE_URL',
    options.image,
    ...command,
  ];
}
