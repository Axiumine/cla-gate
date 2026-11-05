// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// E09-S03: where a contributor signs the CLA for one pull request. The Check Run and the pull request comment (E09-S07) link
// to it, and the single-page app serves it (E13 the context endpoint, E18 the page). The link names the repository by its
// numeric GitHub id, which stays the same when the repository is renamed or transferred, and the pull request by its number.
// It never holds a login, an email address, a token or a commit SHA, so a link pasted anywhere reveals nothing.

/** The largest pull request number: `pr_evaluations.pr_number` is a 32-bit integer. */
export const MAX_PR_NUMBER = 2_147_483_647;

/**
 * Thrown for a repository id, a pull request number or a base URL that cannot make a sign link. Carries none of the values.
 *
 * @internal
 */
export class InvalidSignLinkError extends Error {
  override readonly name = 'InvalidSignLinkError';

  constructor(what: 'repository id' | 'pull request number' | 'base URL') {
    super(`Not a valid ${what} for a sign link`);
  }
}

/** @throws InvalidSignLinkError when `githubRepoId` is not a positive safe integer. */
function requireRepositoryId(githubRepoId: number): void {
  if (!Number.isSafeInteger(githubRepoId) || githubRepoId < 1) {
    throw new InvalidSignLinkError('repository id');
  }
}

/**
 * The path of the sign page of a pull request: `/sign/{githubRepoId}?pr={prNumber}`.
 * @throws InvalidSignLinkError when `githubRepoId` is not a positive safe integer or `prNumber` is not an integer from 1 to
 * {@link MAX_PR_NUMBER}; both are checked before anything is formatted.
 *
 * @internal
 */
export function signPath(githubRepoId: number, prNumber: number): string {
  requireRepositoryId(githubRepoId);
  if (!Number.isSafeInteger(prNumber) || prNumber < 1 || prNumber > MAX_PR_NUMBER) {
    throw new InvalidSignLinkError('pull request number');
  }
  return `/sign/${githubRepoId}?pr=${prNumber}`;
}

/** A host name of letters, digits, hyphens and dots, or an IPv6 literal. Nothing else: not `)`, `>`, a space or an underscore. */
const HOST_SHAPE = /^(?:[a-z0-9.-]+|\[[0-9a-f:.]+\])$/u;

/**
 * True for the canonical origin of an http or https URL: scheme, host and port, with no path, query, fragment or credentials,
 * and a host of the shape above, so no character that Markdown reads in a link can be in it. The configuration (`PUBLIC_BASE_URL`)
 * asks the same question at boot, so an origin the sign link cannot use never gets past the start-up.
 */
export function isHttpOrigin(text: string): boolean {
  if (!URL.canParse(text)) {
    return false;
  }
  const url = new URL(text);
  return (
    (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === text && HOST_SHAPE.test(url.hostname)
  );
}

/** @throws InvalidSignLinkError when `publicBaseUrl` is not an http or https origin in its canonical form. */
function requireOrigin(publicBaseUrl: string): void {
  if (!isHttpOrigin(publicBaseUrl)) {
    throw new InvalidSignLinkError('base URL');
  }
}

/**
 * The address of the sign page: `publicBaseUrl` (the configured origin of this deployment) followed by {@link signPath}.
 * @throws InvalidSignLinkError for the cases of `signPath`, and when `publicBaseUrl` is not an http or https origin in its
 * canonical form (no path, no trailing slash), which also keeps a character that would end the Markdown link out of the URL.
 */
export function signUrl(publicBaseUrl: string, githubRepoId: number, prNumber: number): string {
  const path = signPath(githubRepoId, prNumber);
  requireOrigin(publicBaseUrl);
  return `${publicBaseUrl}${path}`;
}

/**
 * The address of the sign page of a repository, with no pull request in it: `publicBaseUrl` followed by `/sign/{githubRepoId}`
 * (E22-S03, where the README badge of a project links to). The context endpoint takes `?pr=` as an option (E13-S02), so the page
 * is the same one without it.
 * @throws InvalidSignLinkError when `githubRepoId` is not a positive safe integer, and when `publicBaseUrl` is not an http or
 * https origin in its canonical form (see {@link signUrl}).
 */
export function repositorySignUrl(publicBaseUrl: string, githubRepoId: number): string {
  requireRepositoryId(githubRepoId);
  requireOrigin(publicBaseUrl);
  return `${publicBaseUrl}/sign/${githubRepoId}`;
}
