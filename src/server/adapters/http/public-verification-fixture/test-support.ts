// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import { parseGithubId } from '../../../../shared/github-id.ts';
import {
  PUBLIC_BADGE_PATH,
  PUBLIC_SIGNER_BADGE_PATH,
  PUBLIC_SIGNER_PATH,
  publicSignerResponseSchema,
} from '../../../../shared/public-verification.ts';
import { matrixWorld } from '../cross-tenant-runner/test-support.ts';
import { parsed } from '../document-fixture/test-support.ts';

// The helpers of the tests of the public signature check (E22-S02) and of its badges (E22-S03), on the world of the cross-tenant matrix: two tenants, the real app on
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

/** The path of the badge of the project with GitHub id `githubRepoId` (E22-S03). */
export const badgePath = (githubRepoId: number | string): string =>
  PUBLIC_BADGE_PATH.replace(':githubRepoId', String(githubRepoId));

/** The path of the badge of the login `login` for the repository with GitHub id `githubRepoId` (E22-S03). */
export const signerBadgePath = (githubRepoId: number | string, login: string): string =>
  PUBLIC_SIGNER_BADGE_PATH.replace(':githubRepoId', String(githubRepoId)).replace(':login', login);

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
  /** Makes a public call with no session and no cookie. */
  const get = (url: string, caller: Caller = {}) =>
    world.app.inject({
      method: 'GET',
      url,
      ...(caller.headers === undefined ? {} : { headers: caller.headers }),
      ...(caller.remoteAddress === undefined ? {} : { remoteAddress: caller.remoteAddress }),
    });
  return {
    ...world,
    get,
    /** Asks the public question. */
    verify: (githubRepoId: number | string, login: string, caller?: Caller) =>
      get(signerPath(githubRepoId, login), caller),
    /** Asks for the badge of the project (E22-S03). */
    projectBadge: (githubRepoId: number | string, caller?: Caller) => get(badgePath(githubRepoId), caller),
    /** Asks for the badge of a signer (E22-S03). */
    signerBadge: (githubRepoId: number | string, login: string, caller?: Caller) =>
      get(signerBadgePath(githubRepoId, login), caller),
  };
}

/** The headers a client sees that do not change from one call to the next: the others are the request id, the date and the budget left. */
export const stableHeaders = (response: { headers: Record<string, unknown> }) => ({
  cacheControl: response.headers['cache-control'],
  origin: response.headers['access-control-allow-origin'],
  type: response.headers['content-type'],
  length: response.headers['content-length'],
  cookie: response.headers['set-cookie'],
});

/** The states in which a repository may not be asked about, each as a change to the world. */
export const NOT_ASKABLE: readonly (readonly [string, (world: PublicWorld) => Promise<unknown>])[] = [
  [
    'enforcement is off',
    (w) => w.db.updateTable('repositories').set({ enabled: false }).where('id', '=', w.t1.plain.repositoryId).execute(),
  ],
  [
    'the maintainers did not opt in',
    (w) =>
      w.db
        .updateTable('repositories')
        .set({ public_verification: false })
        .where('id', '=', w.t1.plain.repositoryId)
        .execute(),
  ],
  [
    'the repository was removed',
    (w) =>
      w.db
        .updateTable('repositories')
        .set({ removed_at: w.clock.now() })
        .where('id', '=', w.t1.plain.repositoryId)
        .execute(),
  ],
  [
    'the installation is suspended',
    (w) =>
      w.db
        .updateTable('installations')
        .set({ suspended_at: w.clock.now() })
        .where('id', '=', w.t1.installationId)
        .execute(),
  ],
  [
    'the installation was uninstalled',
    (w) =>
      w.db
        .updateTable('installations')
        .set({ deleted_at: w.clock.now() })
        .where('id', '=', w.t1.installationId)
        .execute(),
  ],
  [
    'the installation is rejected',
    (w) =>
      w.db
        .updateTable('installations')
        .set({ admission_status: 'rejected', admission_reason: 'policy_changed' })
        .where('id', '=', w.t1.installationId)
        .execute(),
  ],
];

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

/** Repository ids that are not positive safe integers in plain digits, as a client may spell them in a path. */
export const BAD_REPOSITORY_IDS: readonly (readonly [string, string])[] = [
  ['zero', '0'],
  ['negative', '-1'],
  ['letters', 'abc'],
  ['decimal', '1.5'],
  ['leading zero', '09000'],
  ['plus sign', '%2B9000'],
  ['exponent', '9e3'],
  ['hex', '0x2328'],
  ['one past the largest safe integer', '9007199254740992'],
  ['seventeen digits', '10000000000000000'],
  ['a space', '9000%20'],
  ['a trailing dot', '9000.'],
  ['an emoji', '%F0%9F%98%80'],
];

/** Logins that GitHub's pattern refuses: 1 to 39 characters, letters, digits and single hyphens, none at either end. */
export const BAD_LOGINS: readonly (readonly [string, string])[] = [
  ['a leading hyphen', '-octocat'],
  ['a trailing hyphen', 'octocat-'],
  ['a double hyphen', 'octo--cat'],
  ['only a hyphen', '-'],
  ['forty characters', 'a'.repeat(40)],
  ['a hundred characters', 'a'.repeat(100)],
  ['an underscore', 'octo_cat'],
  ['a dot', 'octo.cat'],
  ['an empty login', ''],
  ['a single dot', '.'],
  ['a space', 'octo%20cat'],
  ['a plus', 'octo+cat'],
  ['an at sign', '@octocat'],
  ['a percent-encoded slash', 'octo%2Fcat'],
  ['a percent-encoded NUL', 'octo%00cat'],
  ['a newline', 'octo%0Acat'],
  ['a letter with an accent', 'octoc%C3%A0t'],
  ['an emoji', '%F0%9F%98%80'],
  ['an RTL override', 'octo%E2%80%AEcat'],
  ['a zero-width space', 'octo%E2%80%8Bcat'],
  ['a fullwidth letter', '%EF%BD%8Fctocat'],
];
