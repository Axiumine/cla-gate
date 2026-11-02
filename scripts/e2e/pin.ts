// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { parse } from 'yaml';
import { z } from 'zod';
import { IMAGE_PATTERN, IMAGE_VARIABLE } from '../ci/lib/e2e-run.ts';
import { lookup } from '../ci/lib/env.ts';

// E20-S06: the Playwright version, the image `yarn e2e:update` starts and the image of the `e2e` CI job must be one and
// the same version, and the two images one and the same digest, or baselines written on a developer's machine would not
// come from the browser that CI compares with (a re-pushed tag changes the rendering under a committed baseline).

const EXACT_VERSION = /^\d+\.\d+\.\d+$/;
const SCRIPT_IMAGE = /^mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-noble@(sha256:[0-9a-f]{64})$/;
const DIGEST = /@(sha256:[0-9a-f]{64})$/;
const PACKAGE = '@playwright/test';
const IMAGE_SHAPE = 'mcr.microsoft.com/playwright:v<version>-noble@sha256:<64 hex digits>';

const packageSchema = z.object({
  devDependencies: z.record(z.string(), z.string()).optional(),
  scripts: z.record(z.string(), z.string()).optional(),
});
const workflowSchema = z.object({
  jobs: z.record(z.string(), z.object({ env: z.record(z.string(), z.unknown()).optional() })),
});

interface Pinned {
  readonly version: string;
  readonly digest: string;
}

function pinnedOf(image: string): Pinned | undefined {
  const match = SCRIPT_IMAGE.exec(image);
  return match?.[1] === undefined || match[2] === undefined ? undefined : { version: match[1], digest: match[2] };
}

/** The version and digest of the one `mcr.microsoft.com/playwright:v<version>-noble@sha256:<digest>` image in the script. */
function scriptImage(script: string): Pinned | undefined {
  const images = script.split(/\s+/).filter((word) => word.includes('mcr.microsoft.com/playwright'));
  return images.length === 1 ? images.map(pinnedOf)[0] : undefined;
}

function ciImage(workflow: unknown): Pinned | undefined {
  const image = lookup(lookup(workflowSchema.parse(workflow).jobs, 'e2e')?.env, IMAGE_VARIABLE);
  const version = typeof image === 'string' ? IMAGE_PATTERN.exec(image)?.[1] : undefined;
  const digest = typeof image === 'string' ? DIGEST.exec(image)?.[1] : undefined;
  return version === undefined || digest === undefined ? undefined : { version, digest };
}

/** The problems of the package version and of the `e2e:update` image against it. */
function scriptProblems(version: string | undefined, script: Pinned | undefined): string[] {
  if (script === undefined) {
    return [`the e2e:update script must start exactly one ${IMAGE_SHAPE} image`];
  }
  return script.version === version
    ? []
    : [`the e2e:update image is ${script.version} but ${PACKAGE} is ${String(version)}`];
}

/** The problems of the `e2e` job image against the package version. */
function ciProblems(version: string | undefined, ci: Pinned | undefined): string[] {
  if (ci === undefined) {
    return [`the e2e job needs env ${IMAGE_VARIABLE}: ${IMAGE_SHAPE}`];
  }
  return ci.version === version ? [] : [`the e2e job image is ${ci.version} but ${PACKAGE} is ${String(version)}`];
}

/** What is wrong with the three pins and the digest of the two images, one sentence each; empty when they agree. */
export function pinProblems(packageJson: string, ciYaml: string): string[] {
  const raw: unknown = JSON.parse(packageJson);
  const manifest = packageSchema.parse(raw);
  const version = lookup(manifest.devDependencies, PACKAGE);
  const problems: string[] = [];
  if (version === undefined || !EXACT_VERSION.test(version)) {
    problems.push(`${PACKAGE} must be a devDependency pinned to an exact version (no ^ or ~), got ${String(version)}`);
  }
  const inScript = scriptImage(lookup(manifest.scripts, 'e2e:update') ?? '');
  const workflow: unknown = parse(ciYaml);
  const inCi = ciImage(workflow);
  problems.push(...scriptProblems(version, inScript), ...ciProblems(version, inCi));
  if (inScript !== undefined && inCi !== undefined && inScript.digest !== inCi.digest) {
    problems.push(
      `the e2e:update image digest ${inScript.digest} is not the digest of the e2e job image ${inCi.digest}`,
    );
  }
  return problems;
}
