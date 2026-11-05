// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { installationRowIdSchema } from '../adapters/db/installation-row-id.ts';
import { administeredRepositories, type LookupRepository } from './administered-repositories.ts';
import { GitHubRateLimitedError } from './ports/github-errors.ts';
import { recordingLookup } from './recording-lookup-fixture/test-support.ts';
import { VIEWER } from './role-fixture/test-support.ts';

// Which of some repositories a repository admin administers (E15-S02, E15-S07), as the cached lookup says.

const INSTALLATION = { installationId: installationRowIdSchema.parse(7) };

const repository = (index: number): LookupRepository => ({
  id: index,
  githubRepoId: 1000 + index,
  fullName: `org/repo-${String(index)}`,
  githubInstallationId: 55,
});

test('the repositories the lookup confirms are returned in their own order, and the lookup is asked with the ids it needs', async () => {
  const { asked, lookup } = recordingLookup(new Set(['org/repo-2', 'org/repo-4']));
  const answered = await administeredRepositories(lookup, INSTALLATION, VIEWER, [1, 2, 3, 4].map(repository));
  expect(answered.map(({ id }) => id)).toEqual([2, 4]);
  expect(asked).toEqual(
    [1, 2, 3, 4].map((index) => ({
      installation: 7,
      githubInstallationId: 55,
      fullName: `org/repo-${String(index)}`,
      githubRepoId: 1000 + index,
    })),
  );
});

test('no repository is no lookup, and a repository it does not confirm is left out', async () => {
  const { asked, lookup } = recordingLookup(new Set());
  expect(await administeredRepositories(lookup, INSTALLATION, VIEWER, [])).toEqual([]);
  expect(await administeredRepositories(lookup, INSTALLATION, VIEWER, [repository(1)])).toEqual([]);
  expect(asked).toHaveLength(1);
});

test('the lookups run five at a time, never more', async () => {
  const { lookup, state } = recordingLookup('all');
  await administeredRepositories(
    lookup,
    INSTALLATION,
    VIEWER,
    Array.from({ length: 23 }, (_unused, index) => repository(index)),
  );
  expect(state.mostRunning).toBe(5);
});

test('a lookup that fails fails the call, and is never a repository the person does not administer', async () => {
  const failing = () => Promise.reject(new GitHubRateLimitedError(60, 'primary'));
  await expect(administeredRepositories(failing, INSTALLATION, VIEWER, [repository(1)])).rejects.toBeInstanceOf(
    GitHubRateLimitedError,
  );
});
