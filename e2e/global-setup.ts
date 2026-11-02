// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import process from 'node:process';
import type { FullConfig } from '@playwright/test';
import { assertBaselinePolicy } from '../scripts/e2e/container-guards.ts';

// E20-S06. Runs once before the tests; the logic is in scripts/e2e/container-guards.ts, where it is tested.
export default function globalSetup(config: Pick<FullConfig, 'updateSnapshots'>): void {
  assertBaselinePolicy(config.updateSnapshots, process.env);
}
