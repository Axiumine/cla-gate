// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect } from 'vitest';
import {
  type ContractCase,
  expectInstallationRefusals,
  id,
  installation,
  repository,
} from '../github-contract/test-support.ts';
import { commitSha } from '../github-pull-contract/test-support.ts';
import type { CheckRunWrite, GitHubCheckRun } from '../ports/github.ts';
import { GitHubNotFoundError, GitHubUnprocessableError } from '../ports/github-errors.ts';

// The Check Run calls (E09-S05) in the contract of the GitHub client port: what the fake and the Octokit adapter both answer
// when a run is created, updated, read and listed for a commit. What the adapter puts on the wire (the body, the query, the
// path, the shapes a port type cannot hold) is in its own tests.

const ACME = 'acme/api';
/** The App that posts the runs the client creates, in both worlds (`GET /app` answers with the same id). */
const OUR_APP = id(4242);

/** An `in_progress` write: what `started` sends. */
export const STARTED: CheckRunWrite = {
  status: 'in_progress',
  title: 'Checking CLA signatures',
  summary: 'Evaluating commit 0000002.',
  startedAt: new Date('2026-11-02T10:00:00Z'),
  externalId: '17',
};

/** A completed write that passes. */
export const PASSED: CheckRunWrite = {
  status: 'completed',
  conclusion: 'success',
  title: 'CLA check passed',
  summary: '1 contributor covered: 1 by signature.',
  completedAt: new Date('2026-11-02T10:01:00Z'),
};

/** A completed write with no conclusion, which GitHub refuses. */
const UNFINISHED: CheckRunWrite = { status: 'completed', title: PASSED.title, summary: PASSED.summary };

/** A run somebody else posted: another App's, completed, on `commitSha(2)`. */
export function foreignRun(runId: number, overrides: Partial<GitHubCheckRun> = {}): GitHubCheckRun {
  return { id: id(runId), headSha: commitSha(2), status: 'completed', appId: id(77), externalId: null, ...overrides };
}

export const CHECK_CASES: readonly ContractCase[] = [
  [
    'createCheckRun returns the new run with its commit, state, the App that posted it and the external id',
    async ({ client, addInstallation }) => {
      addInstallation(installation(11, 'acme'), [repository(101, ACME)]);
      const { id: createdId, ...run } = await client.createCheckRun(id(11), ACME, commitSha(2), STARTED);
      expect(run).toEqual({ headSha: commitSha(2), status: 'in_progress', appId: OUR_APP, externalId: '17' });
      const bare = await client.createCheckRun(id(11), ACME, commitSha(2), PASSED);
      expect([bare.status, bare.externalId]).toEqual(['completed', null]);
      expect(bare.id).not.toBe(createdId);
    },
  ],
  [
    'a run that was created is read back by its id and listed for its commit',
    async ({ client, addInstallation }) => {
      addInstallation(installation(11, 'acme'), [repository(101, ACME)]);
      const run = await client.createCheckRun(id(11), ACME, commitSha(2), STARTED);
      expect(await client.getCheckRun(id(11), ACME, run.id)).toEqual(run);
      expect(await client.listCheckRunsForRef(id(11), ACME, commitSha(2))).toEqual([run]);
    },
  ],
  [
    'updateCheckRun completes the run, keeps its external id when the write names none and replaces it when it names one',
    async ({ client, addInstallation }) => {
      addInstallation(installation(11, 'acme'), [repository(101, ACME)]);
      const run = await client.createCheckRun(id(11), ACME, commitSha(2), STARTED);
      const completed = await client.updateCheckRun(id(11), ACME, run.id, PASSED);
      expect(completed).toEqual({ ...run, status: 'completed' });
      expect(await client.getCheckRun(id(11), ACME, run.id)).toEqual(completed);
      const renamed = await client.updateCheckRun(id(11), ACME, run.id, {
        ...PASSED,
        externalId: '18',
        text: 'The details of the check.',
      });
      expect(renamed.externalId).toBe('18');
    },
  ],
  [
    'a completed run without a conclusion is refused as unprocessable, when it is created and when it is updated, and nothing changes',
    async ({ client, addInstallation }) => {
      addInstallation(installation(11, 'acme'), [repository(101, ACME)]);
      const run = await client.createCheckRun(id(11), ACME, commitSha(2), STARTED);
      await expect(client.createCheckRun(id(11), ACME, commitSha(2), UNFINISHED)).rejects.toBeInstanceOf(
        GitHubUnprocessableError,
      );
      await expect(client.updateCheckRun(id(11), ACME, run.id, UNFINISHED)).rejects.toBeInstanceOf(
        GitHubUnprocessableError,
      );
      expect(await client.listCheckRunsForRef(id(11), ACME, commitSha(2))).toEqual([run]);
    },
  ],
  [
    'updateCheckRun and getCheckRun do not find a run nobody posted, one of another repository or installation, or under a name GitHub cannot hold',
    async ({ client, addInstallation }) => {
      addInstallation(installation(11, 'acme'), [repository(101, ACME), repository(102, 'acme/other')]);
      addInstallation(installation(12, 'globex'), [repository(201, 'globex/api')]);
      const run = await client.createCheckRun(id(11), ACME, commitSha(2), STARTED);
      const strangers = [
        () => client.updateCheckRun(id(11), ACME, id(1), PASSED),
        () => client.updateCheckRun(id(11), 'acme/other', run.id, PASSED),
        () => client.updateCheckRun(id(11), 'globex/api', run.id, PASSED),
        () => client.updateCheckRun(id(12), 'globex/api', run.id, PASSED),
        () => client.updateCheckRun(id(11), '../api', run.id, PASSED),
      ];
      for (const attempt of strangers) {
        await expect(attempt()).rejects.toBeInstanceOf(GitHubNotFoundError);
      }
      expect(await client.getCheckRun(id(11), ACME, id(1))).toBeNull();
      expect(await client.getCheckRun(id(11), 'acme/other', run.id)).toBeNull();
      expect(await client.getCheckRun(id(12), 'globex/api', run.id)).toBeNull();
      expect(await client.getCheckRun(id(11), '../api', run.id)).toBeNull();
    },
  ],
  [
    'createCheckRun throws not found for a repository the installation does not reach and for a name or a SHA GitHub cannot hold',
    async ({ client, addInstallation }) => {
      addInstallation(installation(11, 'acme'), [repository(101, ACME)]);
      addInstallation(installation(12, 'globex'), [repository(201, 'globex/api')]);
      const refused: readonly [name: string, sha: string][] = [
        ['globex/api', commitSha(2)],
        ['acme/missing', commitSha(2)],
        ['acme/a b', commitSha(2)],
        [ACME, 'main'],
        [ACME, commitSha(0xabc).toUpperCase()],
      ];
      for (const [name, sha] of refused) {
        await expect(client.createCheckRun(id(11), name, sha, STARTED)).rejects.toBeInstanceOf(GitHubNotFoundError);
      }
      expect(await client.listCheckRunsForRef(id(11), ACME, commitSha(2))).toEqual([]);
    },
  ],
  [
    'the repository name is compared without regard to case, as GitHub does',
    async ({ client, addInstallation }) => {
      addInstallation(installation(11, 'acme'), [repository(101, ACME)]);
      const run = await client.createCheckRun(id(11), 'ACME/Api', commitSha(2), STARTED);
      expect(await client.getCheckRun(id(11), ACME, run.id)).toEqual(run);
      expect(await client.listCheckRunsForRef(id(11), 'Acme/API', commitSha(2))).toEqual([run]);
    },
  ],
  [
    'listCheckRunsForRef returns the latest run of each App on the commit, newest first, whoever posted it',
    async ({ client, addInstallation, addCheckRun }) => {
      addInstallation(installation(11, 'acme'), [repository(101, ACME)]);
      addCheckRun(id(11), ACME, foreignRun(55, { status: 'in_progress' }));
      addCheckRun(id(11), ACME, foreignRun(56));
      addCheckRun(id(11), ACME, foreignRun(57, { appId: null }));
      addCheckRun(id(11), ACME, foreignRun(58, { headSha: commitSha(3) }));
      const ours = await client.createCheckRun(id(11), ACME, commitSha(2), STARTED);
      const listed = await client.listCheckRunsForRef(id(11), ACME, commitSha(2));
      expect(listed.map((run) => [run.id, run.appId, run.status])).toEqual([
        [ours.id, OUR_APP, 'in_progress'],
        [57, null, 'completed'],
        [56, 77, 'completed'],
      ]);
    },
  ],
  [
    'listCheckRunsForRef returns an empty list for a commit with no run, one of another repository or installation, and a SHA GitHub cannot hold',
    async ({ client, addInstallation, addCheckRun }) => {
      addInstallation(installation(11, 'acme'), [repository(101, ACME), repository(102, 'acme/other')]);
      addInstallation(installation(12, 'globex'), [repository(201, 'globex/api')]);
      addCheckRun(id(12), 'globex/api', foreignRun(55));
      addCheckRun(id(11), 'acme/other', foreignRun(56));
      expect(await client.listCheckRunsForRef(id(11), ACME, commitSha(2))).toEqual([]);
      expect(await client.listCheckRunsForRef(id(11), ACME, commitSha(9))).toEqual([]);
      for (const sha of ['main', 'HEAD~1', `${commitSha(2)}/x`, commitSha(0xabc).toUpperCase(), '']) {
        expect(await client.listCheckRunsForRef(id(11), ACME, sha)).toEqual([]);
      }
    },
  ],
  [
    'listCheckRunsForRef throws not found for a repository the installation does not reach and for a name GitHub cannot hold',
    async ({ client, addInstallation }) => {
      addInstallation(installation(11, 'acme'), [repository(101, ACME)]);
      addInstallation(installation(12, 'globex'), [repository(201, 'globex/api')]);
      for (const name of ['globex/api', 'acme/missing', '../api', 'acme/a b', 'acme']) {
        await expect(client.listCheckRunsForRef(id(11), name, commitSha(2))).rejects.toBeInstanceOf(
          GitHubNotFoundError,
        );
      }
    },
  ],
  [
    'the Check Run calls answer a view with a signal that has not aborted, and send nothing once it has',
    async ({ client, addInstallation, reached }) => {
      addInstallation(installation(11, 'acme'), [repository(101, ACME)]);
      const run = await client
        .withSignal(new AbortController().signal)
        .createCheckRun(id(11), ACME, commitSha(2), STARTED);
      const before = reached();
      const reason = new Error('the job was aborted');
      const aborted = client.withSignal(AbortSignal.abort(reason));
      for (const call of [
        () => aborted.createCheckRun(id(11), ACME, commitSha(2), STARTED),
        () => aborted.updateCheckRun(id(11), ACME, run.id, PASSED),
        () => aborted.getCheckRun(id(11), ACME, run.id),
        () => aborted.listCheckRunsForRef(id(11), ACME, commitSha(2)),
      ]) {
        await expect(call()).rejects.toBe(reason);
      }
      expect(reached()).toBe(before);
    },
  ],
  [
    'the Check Run calls are refused for an installation the gate refuses, gone for one GitHub no longer has, and suspended for a suspended one',
    async ({ client, addInstallation, ...world }) => {
      addInstallation(installation(11, 'acme'));
      addInstallation(installation(12, 'globex'));
      await expectInstallationRefusals(world, (installationId) => [
        () => client.createCheckRun(id(installationId), ACME, commitSha(2), STARTED),
        () => client.updateCheckRun(id(installationId), ACME, id(1), PASSED),
        () => client.getCheckRun(id(installationId), ACME, id(1)),
        () => client.listCheckRunsForRef(id(installationId), ACME, commitSha(2)),
      ]);
    },
  ],
];
