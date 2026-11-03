// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../../shared/github-id.ts';

// What a GitHub call can fail with (E05-S02). The messages are fixed text: a token, a key, a request header or a
// response body never reaches one, so an error can be logged and thrown to any caller as it is. No `cause` is kept
// either: the cause of a failed request can quote the request.

/** GitHub refused the App's credentials: a 401 for every signing key we hold. */
export class GitHubAuthError extends Error {
  override readonly name = 'GitHubAuthError';

  constructor(message = 'GitHub refused the App credentials') {
    super(message);
  }
}

/** GitHub could not be reached or answered with a failure that is its own (network error, timeout, 5xx). */
export class GitHubUnavailableError extends Error {
  override readonly name = 'GitHubUnavailableError';
}

/** GitHub answered 2xx with something that is not what the route's schema says. Carries the route, never the body. */
export class GitHubResponseError extends Error {
  override readonly name = 'GitHubResponseError';
  /** The route template, for example `GET /app`. */
  readonly route: string;
  /** Where in the body the schema failed (`owner`, `permissions.checks`); empty for a body that is not JSON. */
  readonly paths: readonly string[];

  constructor(route: string, paths: readonly string[]) {
    super(`GitHub's answer to ${route} is not what was expected (${paths.join(', ') || 'not JSON'})`);
    this.route = route;
    this.paths = paths;
  }
}

// What the installation token provider adds (E05-S03). An installation is a tenant: these say that one cannot be served
// right now, so the caller skips it instead of retrying (E09 maps them to a skipped job).

/** GitHub answered 404 to a token request: the installation was uninstalled. */
export class InstallationGoneError extends Error {
  override readonly name = 'InstallationGoneError';
  readonly githubInstallationId: GithubId;

  constructor(githubInstallationId: GithubId) {
    super(`GitHub installation ${githubInstallationId} no longer exists`);
    this.githubInstallationId = githubInstallationId;
  }
}

/** GitHub answered 403 saying the installation is suspended: no token is issued until it is unsuspended. */
export class InstallationSuspendedError extends Error {
  override readonly name = 'InstallationSuspendedError';
  readonly githubInstallationId: GithubId;

  constructor(githubInstallationId: GithubId) {
    super(`GitHub installation ${githubInstallationId} is suspended`);
    this.githubInstallationId = githubInstallationId;
  }
}

/**
 * Why the instance does not serve an installation: the admission policy rejected its account (`rejected`), it was
 * uninstalled (`deleted`), GitHub suspended it (`suspended`), it is not a known row (`unknown`), or no gate is wired
 * (`not_wired`, which fails closed).
 */
export type NotAdmittedReason = 'rejected' | 'deleted' | 'suspended' | 'unknown' | 'not_wired';

/** The {@link InstallationGate} refused the installation, so no request to GitHub was made for it. */
export class InstallationNotAdmittedError extends Error {
  override readonly name = 'InstallationNotAdmittedError';
  readonly reason: NotAdmittedReason;

  constructor(reason: NotAdmittedReason) {
    super(`The installation is not served (${reason})`);
    this.reason = reason;
  }
}

// What the GitHub client adds (E05-S04). Each says what GitHub answered to one route; the message names the route
// template (`GET /repositories/{repository_id}`), never a URL, a header or a body.

/** GitHub answered 404 to a request. The methods that treat "does not exist" as an answer resolve null instead. */
export class GitHubNotFoundError extends Error {
  override readonly name = 'GitHubNotFoundError';
  /** The route template, for example `GET /installation/repositories`. */
  readonly route: string;

  constructor(route: string) {
    super(`GitHub answered 404 to ${route}`);
    this.route = route;
  }
}

/** GitHub answered 403 to a request that is not a rate limit: the credentials do not allow it (permission, policy). */
export class GitHubForbiddenError extends Error {
  override readonly name = 'GitHubForbiddenError';
  /** The route template, for example `GET /orgs/{org}/memberships/{username}`. */
  readonly route: string;

  constructor(route: string) {
    super(`GitHub answered 403 to ${route}`);
    this.route = route;
  }
}

/**
 * GitHub answered 422 to a request: the request was understood and refused for what it says (E09-S05, a Check Run that
 * cannot be updated or a body it will not take). The cases that use it, a Check Run `PATCH` that falls back to a new run
 * and the minimal-output retry of E09-S06, tell it from an outage; the message names the route only.
 */
export class GitHubUnprocessableError extends Error {
  override readonly name = 'GitHubUnprocessableError';
  /** The route template, for example `PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}`. */
  readonly route: string;

  constructor(route: string) {
    super(`GitHub answered 422 to ${route}`);
    this.route = route;
  }
}

// What the rate limits add (E05-S05). The adapter waits out a short limit itself; this is what is left for the caller.

/**
 * Which of GitHub's limits answered: `primary` is the hourly budget of the credential (`x-ratelimit-remaining: 0`),
 * `secondary` is every other limit (bursts, concurrency, content creation), with or without `retry-after`.
 */
export type RateLimitScope = 'primary' | 'secondary';

/**
 * GitHub is limiting the installation (or the App) and the wait is too long to sit through, or short waits were
 * already spent: the adapter waited twice and the third answer was a limit again. `retryAfterSeconds` is how long
 * GitHub asked to wait, at least 1. No sleeping happened for it, so the job layer (E07-S03) decides when to retry.
 */
export class GitHubRateLimitedError extends Error {
  override readonly name = 'GitHubRateLimitedError';
  readonly retryAfterSeconds: number;
  readonly scope: RateLimitScope;

  constructor(retryAfterSeconds: number, scope: RateLimitScope) {
    super(`GitHub rate limit (${scope}): retry after ${retryAfterSeconds} s`);
    this.retryAfterSeconds = retryAfterSeconds;
    this.scope = scope;
  }
}
