// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import type { DisplayNames } from '../../domain/reporting/display-names.ts';
import {
  FakeReporter,
  FULL_NAME,
  INSTALLATION,
  PR_NUMBER,
  passing,
  REPOSITORY,
} from '../../services/evaluate-pr/test-support.ts';
import type { ReportTarget } from '../../services/ports/reporter.ts';
import { interleaved } from './repository-flow-fixture/test-support.ts';

// The reporter of the interleaving tests (E14-S04) does what the reporter it wraps does, and runs the action of each cut once, at
// the point of the evaluation that the cut names: the tests that stand on it can then trust where a switch-off lands.

const RUN = {
  githubInstallationId: INSTALLATION,
  githubRepoId: REPOSITORY,
  fullName: FULL_NAME,
  prNumber: PR_NUMBER,
  headSha: 'a'.repeat(40),
  evaluationId: 1,
};
const TARGET: ReportTarget = { ...RUN, trigger: 'pull_request' };
const NAMES: DisplayNames = { logins: new Map(), coAuthors: new Map() };

test('the action of a cut runs once, right after the run was opened, right before the verdict, or right after it, and the events of the inner reporter keep their order', async () => {
  const inner = new FakeReporter();
  const cut = (name: string) => () => {
    inner.timeline.push(`cut:${name}`);
    return Promise.resolve();
  };
  const reporter = interleaved(inner, {
    'after-started': cut('after-started'),
    'before-publish': cut('before-publish'),
    'after-publish': cut('after-publish'),
  });
  await reporter.started(TARGET);
  await reporter.publish(TARGET, passing(), NAMES);
  await reporter.started(TARGET);
  expect(inner.timeline).toEqual([
    'reporter.started',
    'cut:after-started',
    'cut:before-publish',
    'reporter.publish',
    'cut:after-publish',
    'reporter.started',
  ]);
});

test('the other reports go through to the inner reporter untouched', async () => {
  const inner = new FakeReporter();
  const reporter = interleaved(inner, {});
  await reporter.failed(TARGET, 'evaluation_failed');
  await reporter.cancelled(RUN);
  await reporter.enforcementDisabled(RUN);
  expect(inner.timeline).toEqual(['reporter.failed', 'reporter.cancelled', 'reporter.enforcement_disabled']);
});
