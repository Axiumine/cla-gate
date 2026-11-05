// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { sql } from 'kysely';
import { expect, test } from 'vitest';
import { HOSTILE_NAMES } from '../../../shared/hostile-names.ts';
import { commit, commitSha } from '../../services/github-pull-contract/test-support.ts';
import {
  listOverridesAs,
  overrideOf,
  overrideWorld,
  pageOf,
  recordWith,
  removeOverrideAs,
} from './commit-override-fixture/test-support.ts';

// Text a maintainer typed (E15-S06): the reason of an override is free text, returned by the list as it was stored, byte for byte and not
// escaped here (every screen escapes it for its own context, E17), and it never reaches an audit row, whose metadata holds ids and the
// commit only.

/** Markup, a spreadsheet formula and a line break in one reason; `zzzz` is a marker that no random request id can hold. */
const HOSTILE_REASON =
  '<img src=x onerror=alert("zzzz")>\n=HYPERLINK("http://zzzz.example/","zzzz")\n@everyone &#64;zzzz';

/** Every audit row of the database with its metadata as text, which is what a reader of the log sees. */
async function auditMetadata(world: Awaited<ReturnType<typeof overrideWorld>>): Promise<string[]> {
  const rows = await sql<{ metadata: string }>`select metadata::text as metadata from audit_log order by id`.execute(
    world.db,
  );
  return rows.rows.map((row) => row.metadata);
}

test('a reason with markup, a formula prefix and a line break is returned by the list unchanged and absent from every audit row, the record and the removal included', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  world.fakeGitHub.setRepositoryCommits(t1.githubInstallationId, t1.plain.fullName, [commit(0x5a5a)]);
  const response = await recordWith(world, 'admin1', t1.plain.repositoryId, {
    commitSha: commitSha(0x5a5a),
    reason: HOSTILE_REASON,
  });
  expect(response.statusCode).toBe(201);
  const listed = await listOverridesAs(world, 'admin1', t1.plain.repositoryId);
  expect(pageOf(listed).items.map((item) => item.reason)).toContain(HOSTILE_REASON);
  expect(listed.body).toContain('<img src=x onerror=alert(\\"zzzz\\")>\\n=HYPERLINK(');
  expect(listed.body).not.toContain('&lt;');
  expect(listed.body).not.toContain('\\u003c');
  const removed = await removeOverrideAs(world, 'admin1', t1.plain.repositoryId, overrideOf(response).id);
  expect(removed.statusCode).toBe(204);
  const metadata = await auditMetadata(world);
  expect(metadata.length).toBeGreaterThanOrEqual(2);
  expect(
    metadata.filter((text) => text.includes('zzzz') || text.includes('<img') || text.includes('=HYPERLINK')),
  ).toEqual([]);
});

test('every name of the hostile corpus is a valid reason, and the list returns each byte for byte while the audit rows hold ids and the commit only', async () => {
  const world = await overrideWorld();
  const { t1 } = world;
  const names = [...HOSTILE_NAMES];
  world.fakeGitHub.setRepositoryCommits(
    t1.githubInstallationId,
    t1.plain.fullName,
    names.map((_name, index) => commit(index + 1)),
  );
  for (const [index, name] of names.entries()) {
    const response = await recordWith(world, 'admin1', t1.plain.repositoryId, {
      commitSha: commitSha(index + 1),
      reason: name,
    });
    expect([name, response.statusCode]).toEqual([name, 201]);
  }
  const listed = pageOf(await listOverridesAs(world, 'admin1', t1.plain.repositoryId, '?limit=100'));
  const byCommit = new Map(listed.items.map((item) => [item.commitSha, item.reason]));
  expect(names.map((_name, index) => byCommit.get(commitSha(index + 1)))).toEqual(names);
  const audit = await world.db
    .selectFrom('audit_log')
    .select('metadata')
    .where('action', '=', 'commit_override.created')
    .execute();
  expect(audit).toHaveLength(names.length);
  expect(audit.map((row) => Object.keys(row.metadata).toSorted((a, b) => a.localeCompare(b)))).toEqual(
    names.map(() => ['commit_sha', 'repository_id']),
  );
});
