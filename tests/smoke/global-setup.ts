// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { TestProject } from 'vitest/node';
import { startStack } from '../../scripts/smoke/stack.ts';
import type { StackInfo } from '../../scripts/smoke/stack-types.ts';
import { stackDeps } from '../../scripts/smoke/system.ts';

// E19-S08: starts the operator stack once for the whole smoke run (setup mode: no GitHub App yet) and removes it again, volumes
// and image included, when the run ends, whatever its outcome. The test files connect to it through `inject('stack')`. The
// logs of the stack are written to reports/smoke before it goes (the workflow uploads them when a step failed), and the
// `if: always()` step of the job removes whatever a killed run left. Logic-free on purpose: scripts/smoke/ holds the logic.

declare module 'vitest' {
  export interface ProvidedContext {
    /** The setup-mode stack: what a test file needs to talk to it. */
    stack: StackInfo;
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const stack = await startStack(stackDeps, { scenario: 'boot' });
  const { names, directory, port, profiles, environment } = stack;
  project.provide('stack', { names, directory, port, profiles, environment });
  return stack.down;
}
