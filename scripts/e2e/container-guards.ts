// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Env } from '../ci/lib/env.ts';
import { isInContainer } from './settings.ts';

// E20-S06: visual baselines come from one environment, the pinned Playwright container. Two guards keep them there: the
// global setup refuses to write one anywhere else, and a visual spec does not even compare outside the container.

export const REFUSAL = 'Refusing to write visual baselines outside the pinned container';

/**
 * Throws unless the run cannot write a baseline (`updateSnapshots` is `none`) or runs inside the container.
 * @param updateSnapshots the resolved mode: Playwright's default `missing` writes baselines, so the config sets `none`.
 */
export function assertBaselinePolicy(updateSnapshots: string, env: Env): void {
  if (updateSnapshots !== 'none' && !isInContainer(env)) {
    throw new Error(REFUSAL);
  }
}

export const VISUAL_SKIP_REASON =
  'Visual baselines are compared only inside the pinned Playwright container (yarn e2e:update sets E2E_CONTAINER=1)';

/** Specs whose name ends in `.visual.spec.ts` (or the .js, .mts and .tsx spellings of it). */
const VISUAL_SPEC = /\.visual\.spec\.[cm]?[jt]sx?$/;

export function isVisualSpec(file: string): boolean {
  return VISUAL_SPEC.test(file);
}

/** Why a spec file must be skipped on this machine, or undefined when it may run. */
export function visualSkipReason(file: string, env: Env): string | undefined {
  return isVisualSpec(file) && !isInContainer(env) ? VISUAL_SKIP_REASON : undefined;
}
