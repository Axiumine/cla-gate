// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { createHash, randomInt } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { InstallationRowId } from '../../../src/server/adapters/db/installation-row-id.ts';
import type { Database } from '../../../src/server/adapters/db/schema.ts';
import type { Person } from './people.ts';
import { ensureSession } from './people-rows.ts';

// E18-S12: the world of the specs that change things. Nobody in it is in the world the baselines show, and every number is new in
// each run, so a second run never meets what the first one wrote, and what a spec writes never reaches a screen that is photographed.
// The maintainer owns a user account, so the guard knows them as an org admin with no call to GitHub; the second tenant belongs to
// someone else, to show in the browser that a tenant is not reachable by the address alone.

export interface FlowTenant {
  /** `installations.id`, the number of the address. */
  readonly id: InstallationRowId;
  readonly login: string;
}

export interface FlowRepository {
  readonly id: number;
  readonly githubId: number;
  readonly name: string;
}

export interface FlowWorld {
  readonly maintainer: Person;
  readonly contributor: Person;
  readonly stranger: Person;
  readonly tenant: FlowTenant;
  readonly repository: FlowRepository;
  /** The installation of the stranger, which the maintainer is no admin of. */
  readonly foreign: FlowTenant;
  /** The login snapshot of the one allowlist entry the tenant starts with. */
  readonly allowlisted: string;
}

/** A made-up person with numbers that are new in this run: `n` tells the people of one run apart. */
function newcomer(run: number, n: number, role: string, emails: readonly string[]): Person {
  const login = `e2e-${role}-${String(run)}`;
  return {
    rowId: 0,
    githubId: 200_000_000 + run * 10 + n,
    login,
    name: `${role[0]?.toUpperCase() ?? ''}${role.slice(1)} Run${String(run)}`,
    emails: emails.map((email, index) => ({ email, primary: index === 0 })),
    cookie: createHash('sha256').update(`cla-e2e-session:${login}`).digest('base64url'),
  };
}

async function user(db: Kysely<Database>, person: Person): Promise<Person> {
  const row = await db
    .insertInto('users')
    .values({ github_id: person.githubId, login: person.login, name: person.name, avatar_url: null })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { ...person, rowId: row.id };
}

async function tenant(db: Kysely<Database>, owner: Person, login: string, n: number): Promise<FlowTenant> {
  const row = await db
    .insertInto('installations')
    .values({
      github_installation_id: 300_000_000 + owner.githubId + n,
      account_id: owner.githubId,
      account_login: login,
      account_type: 'User',
      admission_status: 'admitted',
      admission_decided_at: new Date(),
      last_synced_at: new Date(),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { id: row.id, login };
}

/**
 * Writes a maintainer, a contributor and a stranger, the maintainer's tenant with one repository that does not enforce a CLA yet,
 * the stranger's tenant, and a live session for each person. Nothing is signed and nothing is published: the specs do that.
 */
export async function seedFlowWorld(db: Kysely<Database>, now: Date): Promise<FlowWorld> {
  const run = randomInt(1_000_000, 90_000_000);
  const maintainer = await user(db, newcomer(run, 1, 'maintainer', [`maintainer-${String(run)}@example.test`]));
  const contributor = await user(
    db,
    newcomer(run, 2, 'contributor', [
      `contributor-${String(run)}@example.test`,
      `contributor-${String(run)}.alt@example.test`,
    ]),
  );
  const stranger = await user(db, newcomer(run, 3, 'stranger', [`stranger-${String(run)}@example.test`]));
  const own = await tenant(db, maintainer, `e2e-org-${String(run)}`, 1);
  const foreign = await tenant(db, stranger, `e2e-other-${String(run)}`, 2);
  const repository: FlowRepository = { id: 0, githubId: 700_000_000 + run, name: `${own.login}/project` };
  const row = await db
    .insertInto('repositories')
    .values({ installation_id: own.id, github_repo_id: repository.githubId, full_name: repository.name })
    .returning('id')
    .executeTakeFirstOrThrow();
  const allowlisted = `e2e-trusted-${String(run)}`;
  await db
    .insertInto('allowlist_entries')
    .values({
      installation_id: own.id,
      repository_id: null,
      kind: 'user',
      github_id: 200_000_000 + run * 10 + 4,
      login_snapshot: allowlisted,
      created_by: maintainer.rowId,
    })
    .execute();
  for (const person of [maintainer, contributor, stranger]) {
    await ensureSession(db, person, now);
  }
  return {
    maintainer,
    contributor,
    stranger,
    tenant: own,
    repository: { ...repository, id: row.id },
    foreign,
    allowlisted,
  };
}
