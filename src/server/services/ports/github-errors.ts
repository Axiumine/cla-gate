// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

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
