// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import { FakeReporter, FULL_NAME, INSTALLATION, REPOSITORY } from './test-support.ts';

// The double of the reporter that the jobs are tested with (E07-S04): every report is kept in order, on the timeline it shares
// with the other fakes, and answers that the report was made. `enforcementDisabled` is the method of E09-S06, which the job of
// E14-S04 calls and no job of E07 does.

const TARGET = {
  githubInstallationId: INSTALLATION,
  githubRepoId: REPOSITORY,
  fullName: FULL_NAME,
  prNumber: 7,
  headSha: '0000000000000000000000000000000000000002',
  evaluationId: 11,
};

test('enforcementDisabled keeps the target, notes the event on the timeline, runs its hook and answers reported', async () => {
  const timeline: string[] = ['db:select pr_evaluations'];
  const reporter = new FakeReporter(timeline);
  const hook = vi.fn<NonNullable<FakeReporter['hooks']['enforcementDisabled']>>(() => Promise.resolve());
  reporter.hooks.enforcementDisabled = hook;
  expect(await reporter.enforcementDisabled(TARGET)).toEqual({ status: 'reported' });
  expect(reporter.disabled).toEqual([TARGET]);
  expect(timeline).toEqual(['db:select pr_evaluations', 'reporter.enforcement_disabled']);
  expect(hook).toHaveBeenCalledExactlyOnceWith(TARGET);
});
