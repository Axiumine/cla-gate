// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import {
  allowlistEntryResponseSchema,
  INSTALLATION_ALLOWLIST_PATH,
  REPOSITORY_ALLOWLIST_PATH,
} from '../../../../shared/allowlist.ts';
import { parseGithubId } from '../../../../shared/github-id.ts';
import { createJobsTable, fakeEnqueuer, type SentJob, sentJobs } from '../../../services/jobs-fixture/test-support.ts';
import type { GitHubUserAccount } from '../../../services/ports/github.ts';
import type { JobEnqueuer } from '../../../services/ports/jobs.ts';
import type { PersonName } from '../../db/tenant-fixture/test-support.ts';
import { type DocumentWorld, documentWorld, parsed } from '../document-fixture/test-support.ts';

// The helpers of the tests of `POST .../allowlist-entries` (E14-S06), on the world of the documents tests: two tenants whose
// installations are organisations GitHub knows, five people, the real app on PGlite, a fake queue that writes into a test table on
// the transaction it is given, and the fake GitHub the accounts are looked up on. Tenant 1 has the plain repository `org-1/repo`
// (GitHub id 9000, off) and `org-1/scoped` (9001, on, with a document of its own); tenant 2 has the same.

/** The path of the entries of the installation `installationId` (`installations.id`). */
const installationEntriesPath = (installationId: number | string): string =>
  INSTALLATION_ALLOWLIST_PATH.replace(':installationId', String(installationId));

/** The path of the entries of the repository `repositoryId` (`repositories.id`). */
const repositoryEntriesPath = (repositoryId: number | string): string =>
  REPOSITORY_ALLOWLIST_PATH.replace(':repositoryId', String(repositoryId));

/** An account of GitHub, as a test scripts it: a person, an automation or an organisation under `login`, with the numeric `id`. */
export const accountOf = (id: number, login: string, type: GitHubUserAccount['type'] = 'User'): GitHubUserAccount => ({
  id: parseGithubId(id),
  login,
  type,
});

/** The account the happy paths add: a person GitHub keeps as `Ada-Lovelace`, id 4711. */
export const ADA = accountOf(4711, 'Ada-Lovelace');
/** An automation, with the `[bot]` suffix GitHub gives its login. */
export const DEPENDABOT = accountOf(49_699_333, 'dependabot[bot]', 'Bot');
/** An organisation that is not the installation's own. */
export const OTHER_ORGANISATION = accountOf(31_337, 'other-org', 'Organization');

/**
 * A world whose queue is `enqueuer` (the fake one unless given), with the jobs table created and `accounts` known to GitHub under
 * their logins. The plain repository of tenant 1 is off; the scoped one is on.
 */
export async function allowlistWorld(
  accounts: readonly GitHubUserAccount[] = [ADA, DEPENDABOT, OTHER_ORGANISATION],
  enqueuer: JobEnqueuer = fakeEnqueuer(),
) {
  const world = await documentWorld({ enqueuer });
  await createJobsTable(world.db);
  for (const account of accounts) {
    world.fakeGitHub.scriptUserAccount(account.login, account);
  }
  return world;
}

/** Adds an entry to the whole installation `installationId` as `who`; `body` is the request body. */
export function addToInstallation(
  world: DocumentWorld,
  who: PersonName | null,
  installationId: number | string,
  body: object,
) {
  return world.ask(who, { method: 'POST', url: installationEntriesPath(installationId), payload: body });
}

/** Adds an entry to the repository `repositoryId` as `who`; `body` is the request body. */
export function addToRepository(
  world: DocumentWorld,
  who: PersonName | null,
  repositoryId: number | string,
  body: object,
) {
  return world.ask(who, { method: 'POST', url: repositoryEntriesPath(repositoryId), payload: body });
}

/** The entry of a `201`, read with the shared schema. */
export const entryOf = (response: { json: () => unknown }) => parsed(response, allowlistEntryResponseSchema).entry;

/** Every row of `allowlist_entries` but the ones the world seeds (GitHub ids 100, 101, 200 and 201), oldest first. */
export async function addedEntries(world: DocumentWorld) {
  return world.db
    .selectFrom('allowlist_entries')
    .selectAll()
    .where('github_id', 'not in', [100, 101, 200, 201])
    .orderBy('id')
    .execute();
}

/** The `sweep-repository` jobs sent so far. */
export async function sweeps(world: DocumentWorld): Promise<SentJob[]> {
  return (await sentJobs(world.db)).filter((sent) => sent.job.type === 'sweep-repository');
}

/** The `allowlist_entry.created` audit rows, oldest first. */
export function createdAuditRows(world: DocumentWorld) {
  return world.db
    .selectFrom('audit_log')
    .selectAll()
    .where('action', '=', 'allowlist_entry.created')
    .orderBy('id')
    .execute();
}
