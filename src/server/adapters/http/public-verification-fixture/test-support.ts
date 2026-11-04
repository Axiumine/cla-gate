// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import { parseGithubId } from '../../../../shared/github-id.ts';
import { PUBLIC_SIGNER_PATH, publicSignerResponseSchema } from '../../../../shared/public-verification.ts';
import { matrixWorld } from '../cross-tenant-runner/test-support.ts';
import { parsed } from '../document-fixture/test-support.ts';

// The helpers of the tests of the public signature check (E22-S02), on the world of the cross-tenant matrix: two tenants, the real app on
// PGlite, and a GitHub in memory that knows three logins. The plain repository of each tenant enforces the tenant's published
// document and is opted in, so the world starts with the check on. `octocat` is the signer of tenant 1 and `hubot` the signer of
// tenant 2; `stranger` is a real account that signed nothing anywhere.

/** The logins the GitHub of the world knows. */
export const LOGINS = { signer1: 'octocat', signer2: 'hubot', stranger: 'stranger' } as const;

/** The numeric id of `stranger`, an account that has signed nothing. */
const STRANGER_ID = parseGithubId(7_000_001);

/** The path of the question for the repository with GitHub id `githubRepoId` and the login `login`, as the client spells them. */
export const signerPath = (githubRepoId: number | string, login: string): string =>
  PUBLIC_SIGNER_PATH.replace(':githubRepoId', String(githubRepoId)).replace(':login', login);

/** What a client may add to a call: the headers it sends, and the address of its socket. */
export interface Caller {
  readonly headers?: Readonly<Record<string, string>>;
  readonly remoteAddress?: string;
}

export type PublicWorld = Awaited<ReturnType<typeof publicWorld>>;

/** The world with the check on for the plain repository of both tenants; `env` adds to the settings of the app (`TRUST_PROXY`, for instance). */
export async function publicWorld(env: Readonly<Record<string, string>> = {}) {
  const world = await matrixWorld(env);
  const { db, fakeGitHub, t1, t2 } = world;
  for (const tenant of [t1, t2]) {
    await db
      .updateTable('repositories')
      .set({ enabled: true, cla_document_id: tenant.documentId, public_verification: true })
      .where('id', '=', tenant.plain.repositoryId)
      .execute();
  }
  fakeGitHub.scriptUserAccount(LOGINS.signer1, { id: t1.signer.githubId, login: LOGINS.signer1, type: 'User' });
  fakeGitHub.scriptUserAccount(LOGINS.signer2, { id: t2.signer.githubId, login: LOGINS.signer2, type: 'User' });
  fakeGitHub.scriptUserAccount(LOGINS.stranger, { id: STRANGER_ID, login: LOGINS.stranger, type: 'User' });
  /** Asks the public question with no session and no cookie. */
  const verify = (githubRepoId: number | string, login: string, caller: Caller = {}) =>
    world.app.inject({
      method: 'GET',
      url: signerPath(githubRepoId, login),
      ...(caller.headers === undefined ? {} : { headers: caller.headers }),
      ...(caller.remoteAddress === undefined ? {} : { remoteAddress: caller.remoteAddress }),
    });
  return { ...world, verify };
}

/** The answer of a call that succeeded, read with the shared schema. */
export const signedOf = (response: { json: () => unknown }): boolean =>
  parsed(response, publicSignerResponseSchema).signed;

/** The `getUserAccount` calls the GitHub of the world has served so far. */
export const lookups = (world: PublicWorld): number =>
  world.fakeGitHub.calls.filter((call) => call.method === 'getUserAccount').length;

/** Revokes the signature of tenant 1 past the routes, now by the wall clock: the database wants a revocation after the signature, and the clock of the world stands at its start. */
export async function revokeSignature(world: PublicWorld): Promise<void> {
  await world.db
    .updateTable('signatures')
    .set({ revoked_at: new Date(), revoked_by: world.t1.publisherId, revoke_reason: 'maintainer_decision' })
    .where('id', '=', world.t1.signatureId)
    .execute();
}
