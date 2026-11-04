// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import type { EnvelopeOf } from '../../domain/job-envelope.ts';
import { evaluatePr } from '../../services/evaluate-pr/evaluate-pr.ts';
import { disableAs } from './repository-disable-fixture/test-support.ts';
import { setEnabled } from './repository-document-fixture/test-support.ts';
import { COVERED, flowWorld, interleaved, UNCOVERED } from './repository-flow-fixture/test-support.ts';

// A repository is switched off while an `evaluate-pr` job is running (E14-S04), with GitHub stubbed by MSW behind the real Octokit
// adapter and the real reporter: the disable and the jobs it sends (the finalisation of the repository and of each pull request)
// run to the end at a chosen point of the evaluation, and whatever the point, the Check Run on the head SHA of the open pull request
// ends `neutral`. The same cuts run concurrently on two connections in repository-disable-race.test.ts.

/**
 * Where in the evaluation the switch-off happens (after the run was opened, just before the verdict is written, just after), and
 * the outcome of the job, and every write the uncovered pull request's run gets, in order: its creation, then the conclusions. The finalisation completes the
 * run `neutral` at the point of the cut; the evaluation then writes over it (before-publish), and its own hand-over completes the
 * run once more, so the last write is neutral in every order.
 */
const CUTS = [
  ['after-started', 'skipped:repository_disabled', ['in_progress', 'neutral', 'neutral']],
  ['before-publish', 'evaluated', ['in_progress', 'neutral', 'failure', 'neutral']],
  ['after-publish', 'evaluated', ['in_progress', 'failure', 'neutral', 'neutral']],
] as const;

test.each(CUTS)(
  'a disable that is committed and finalised %s of an evaluation leaves the check of the uncovered pull request neutral, and the covered one is never red',
  async (cut, outcome, writes) => {
    const world = await flowWorld();
    const { t1 } = world;
    await setEnabled(world, t1.plain.repositoryId, true);
    const envelope = (prNumber: number): EnvelopeOf<'evaluate-pr'> => ({
      type: 'evaluate-pr',
      githubInstallationId: t1.githubInstallationId,
      githubRepoId: t1.plain.githubRepoId,
      prNumber,
      trigger: 'pull_request',
    });
    const context = (jobId: string) => ({ attempt: 0, logger: world.logger, enqueuer: world.queue, jobId });
    await evaluatePr(world.ports, envelope(COVERED), context('eval-covered'));
    expect(await world.conclusionOf(COVERED)).toBe('success');

    const switchOff = async () => {
      expect((await disableAs(world, 'admin1', t1.plain.repositoryId)).statusCode).toBe(200);
      await world.drain();
    };
    const ports = { ...world.ports, reporter: interleaved(world.ports.reporter, { [cut]: switchOff }) };
    expect(await evaluatePr(ports, envelope(UNCOVERED), context('eval-uncovered'))).toEqual({ outcome });
    // The jobs the evaluation handed over run after it, as the queue would run them.
    await world.drain();

    expect(await world.conclusionOf(UNCOVERED)).toBe('neutral');
    expect(await world.conclusionOf(COVERED)).toBe('success');
    // The run of the covered pull request was created and given its verdict before the cut.
    const coveredWrites = 2;
    expect(
      world.github.checkRunWrites.slice(coveredWrites).map((write) => write.write.conclusion ?? write.write.status),
    ).toEqual(writes);
  },
);
