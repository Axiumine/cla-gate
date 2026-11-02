// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { parse } from 'yaml';
import { z } from 'zod';
import { IMAGE_PATTERN, IMAGE_VARIABLE } from '../ci/lib/e2e-run.ts';
import { lookup } from '../ci/lib/env.ts';

// E20-S06: the Playwright version, the image `yarn e2e:update` starts and the image of the `e2e` CI job must be one and
// the same version, or baselines written on a developer's machine would not come from the browser that CI compares with.

const EXACT_VERSION = /^\d+\.\d+\.\d+$/;
const SCRIPT_IMAGE = /^mcr\.microsoft\.com\/playwright:v(\d+\.\d+\.\d+)-noble$/;
const PACKAGE = '@playwright/test';

const packageSchema = z.object({
  devDependencies: z.record(z.string(), z.string()).optional(),
  scripts: z.record(z.string(), z.string()).optional(),
});
const workflowSchema = z.object({
  jobs: z.record(z.string(), z.object({ env: z.record(z.string(), z.unknown()).optional() })),
});

/** The version of a `mcr.microsoft.com/playwright:v<version>-noble` image in the script, or why there is none. */
function scriptVersion(script: string): string | undefined {
  const images = script.split(/\s+/).filter((word) => word.includes('mcr.microsoft.com/playwright'));
  return images.length === 1 ? images.map((image) => SCRIPT_IMAGE.exec(image)?.[1])[0] : undefined;
}

function ciVersion(workflow: unknown): string | undefined {
  const image = lookup(lookup(workflowSchema.parse(workflow).jobs, 'e2e')?.env, IMAGE_VARIABLE);
  return typeof image === 'string' ? IMAGE_PATTERN.exec(image)?.[1] : undefined;
}

/** What is wrong with the three pins, one sentence each; empty when they agree. */
export function pinProblems(packageJson: string, ciYaml: string): string[] {
  const raw: unknown = JSON.parse(packageJson);
  const manifest = packageSchema.parse(raw);
  const version = lookup(manifest.devDependencies, PACKAGE);
  const problems: string[] = [];
  if (version === undefined || !EXACT_VERSION.test(version)) {
    problems.push(`${PACKAGE} must be a devDependency pinned to an exact version (no ^ or ~), got ${String(version)}`);
  }
  const inScript = scriptVersion(lookup(manifest.scripts, 'e2e:update') ?? '');
  if (inScript === undefined) {
    problems.push('the e2e:update script must start exactly one mcr.microsoft.com/playwright:v<version>-noble image');
  } else if (inScript !== version) {
    problems.push(`the e2e:update image is ${inScript} but ${PACKAGE} is ${String(version)}`);
  }
  const workflow: unknown = parse(ciYaml);
  const inCi = ciVersion(workflow);
  if (inCi === undefined) {
    problems.push(
      `the e2e job needs env ${IMAGE_VARIABLE}: mcr.microsoft.com/playwright:v<version>-noble@sha256:<64 hex digits>`,
    );
  } else if (inCi !== version) {
    problems.push(`the e2e job image is ${inCi} but ${PACKAGE} is ${String(version)}`);
  }
  return problems;
}
