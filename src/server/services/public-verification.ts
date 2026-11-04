// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Kysely } from 'kysely';
import type { GithubId } from '../../shared/github-id.ts';
import type { Database } from '../adapters/db/schema.ts';
import { tenantState } from '../domain/tenant-state.ts';
import type { GitHubClient } from './ports/github.ts';
import { GitHubRateLimitedError, GitHubUnavailableError } from './ports/github-errors.ts';
import type { LoginAnswer, LoginCache } from './public-login-cache.ts';
import { findPublicRepository, hasCountingSignature, type PublicRepository } from './public-verification-queries.ts';

// The question of the public signature check (E22-S02): does this GitHub login have a valid signature for this repository? One
// function answers it for every public route that asks (the signer badge of E22-S03 included), so the routes cannot disagree; the
// project badge asks the question before it, whether the repository may be asked about at all. The
// answer is a verdict and never a reason: a repository that may not be asked about is `not_found` whatever the cause, and a login
// that has no counting signature is `signed: false` whether it never signed, signed an older major, was revoked or does not exist.
// Nothing here writes, and nothing is keyed on a stored login: the login is turned into GitHub's numeric id by GitHub, with the
// token of the repository's installation, and the id is what the signature is found by.

/** The one call of the GitHub client port that the check needs. */
export type PublicGitHub = Pick<GitHubClient, 'getUserAccount'>;

/** A GitHub the lookups cannot be made on, for a server built with no GitHub App: every call fails as an outage, so `503 upstream_unavailable`. */
export const publicGitHubNotWired: PublicGitHub = {
  getUserAccount: () =>
    Promise.reject(new GitHubUnavailableError('no GitHub App is configured: logins cannot be looked up')),
};

/** What a client that is told to wait is given when GitHub named no wait of its own: half a minute. */
const DEFAULT_RETRY_AFTER_SECONDS = 30;

/** The longest wait a client is told to sit out, whatever GitHub asked for. */
const MAX_RETRY_AFTER_SECONDS = 300;

/**
 * GitHub could not tell who a login is (a rate limit, an outage, a refusal, an answer that was not an account, a token that was
 * turned down): the check does not guess, so the route answers `503 upstream_unavailable` with `Retry-After`. The message is
 * fixed text and names neither the login nor the repository, so it can be logged as it is.
 */
export class PublicVerificationUnavailableError extends Error {
  override readonly name = 'PublicVerificationUnavailableError';
  /** Whole seconds for the `Retry-After` header: GitHub's wait when it gave one (at most 300), else 30. */
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('GitHub could not tell who the login is');
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** What the check says: the repository may not be asked about, or the verdict for the login. */
export type PublicVerdict = { readonly kind: 'not_found' } | { readonly kind: 'verdict'; readonly signed: boolean };

const NOT_FOUND: PublicVerdict = { kind: 'not_found' };

/** What the check reads: the database, GitHub, and the memory of the logins it asked GitHub about. */
export interface PublicVerificationDeps {
  readonly db: Kysely<Database>;
  readonly github: PublicGitHub;
  readonly logins: LoginCache;
}

/** Whether the repository may be asked about: its installation is served, enforcement is on, and the maintainers opted in. */
const askable = (repository: PublicRepository): boolean =>
  tenantState(repository) === 'active' && repository.enabled && repository.publicVerification;

/**
 * Why the lookup failed, as the client is told it: always the same error, with GitHub's own wait when it limited the
 * installation. Nothing GitHub sent, and nothing of the request, is carried on.
 * @throws PublicVerificationUnavailableError always.
 */
function lookupFailed(error: unknown): never {
  throw new PublicVerificationUnavailableError(
    error instanceof GitHubRateLimitedError
      ? Math.min(error.retryAfterSeconds, MAX_RETRY_AFTER_SECONDS)
      : DEFAULT_RETRY_AFTER_SECONDS,
  );
}

/**
 * The numeric id GitHub gives `login`, or `null` when no account has it, as the cache remembers it or as GitHub says it now. The
 * lookup uses the token of the installation that holds the repository and is remembered, a miss as well as a hit, for ten
 * minutes under the login in lower case. A failure is never remembered.
 * @throws PublicVerificationUnavailableError when GitHub cannot answer.
 */
async function resolveLogin(
  deps: PublicVerificationDeps,
  githubInstallationId: GithubId,
  login: string,
): Promise<LoginAnswer> {
  const known = deps.logins.get(login);
  if (known !== undefined) {
    return known;
  }
  let answer: LoginAnswer;
  try {
    const account = await deps.github.getUserAccount(githubInstallationId, login);
    answer = account === null ? null : account.id;
  } catch (error) {
    return lookupFailed(error);
  }
  deps.logins.set(login, answer);
  return answer;
}

/** The repository under this GitHub id when it may be asked about, else `null`: the one reading of "unknown, not enforcing, not opted in, not served" that every public route shares. */
async function findAskable(db: Kysely<Database>, githubRepoId: GithubId): Promise<PublicRepository | null> {
  const repository = await findPublicRepository(db, githubRepoId);
  return repository !== null && askable(repository) ? repository : null;
}

/**
 * Whether the repository with GitHub id `githubRepoId` may be spoken of in public (E22-S03, the project badge): it is known, not
 * removed, enforcing, opted in, and its installation is served. `false` for every other case, and the caller cannot tell which: the
 * answer is the same 404 for an unknown repository, so a project badge is no way to find out which repositories exist. Nothing is
 * asked of GitHub.
 */
export async function isPublicRepository(db: Kysely<Database>, githubRepoId: GithubId): Promise<boolean> {
  return (await findAskable(db, githubRepoId)) !== null;
}

/**
 * Whether `login` has a valid signature for the repository with GitHub id `githubRepoId`. `not_found` for a repository that is
 * unknown, removed, not enforcing, not opted in, or whose installation is rejected, uninstalled or suspended: the caller cannot
 * tell which. Otherwise `signed` is true only when the login's current numeric id has an unrevoked individual signature on the
 * document the repository enforces, at the major version that document has now. A repository with no document to enforce, and a
 * login no account has, are `signed: false` without a signature being looked for.
 * @throws PublicVerificationUnavailableError when GitHub cannot say who the login is.
 */
export async function verifySigner(
  deps: PublicVerificationDeps,
  request: { readonly githubRepoId: GithubId; readonly login: string },
): Promise<PublicVerdict> {
  const repository = await findAskable(deps.db, request.githubRepoId);
  if (repository === null) {
    return NOT_FOUND;
  }
  if (repository.claDocumentId === null) {
    return { kind: 'verdict', signed: false };
  }
  const githubId = await resolveLogin(deps, repository.githubInstallationId, request.login);
  if (githubId === null) {
    return { kind: 'verdict', signed: false };
  }
  const signed = await hasCountingSignature(
    deps.db,
    { installationId: repository.installationId },
    { documentId: repository.claDocumentId, githubId },
  );
  return { kind: 'verdict', signed };
}
