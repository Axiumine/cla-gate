// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { afterAll, beforeAll } from 'vitest';
import { startStack } from '../../scripts/smoke/stack.ts';
import type { Stack, StackOptions } from '../../scripts/smoke/stack-types.ts';
import { stackDeps } from '../../scripts/smoke/system.ts';

// E19-S12: a scenario that changes the state of its stack (it restarts it, stops its database, wipes its volumes) starts one of
// its own, under a compose project name of its own and with volumes of its own, so that a scenario that fails leaves nothing the
// next one reads. The stack is removed after the last test of the file, volumes, image and directory included; the logs are
// written to reports/smoke first, which is what the workflow uploads when a step failed. A start that fails removes itself
// (scripts/smoke/stack.ts) and the `if: always()` step of the job removes whatever a killed process left.

/** Starts the stack before the first test of the file and takes it down after the last; returns the way to reach it. */
export function ownStack(options: StackOptions): () => Stack {
  let started: Stack | undefined;
  beforeAll(async () => {
    started = await startStack(stackDeps, options);
  });
  afterAll(async () => {
    await started?.down();
  });
  return () => {
    if (started === undefined) {
      throw new Error(`the ${options.scenario} stack did not start`);
    }
    return started;
  };
}
