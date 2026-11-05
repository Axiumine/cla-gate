// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { HttpResponse, http } from 'msw';
import { z } from 'zod';
import { findCommit, type ScriptedCommits } from '../../../services/fake-commits/test-support.ts';
import { GITHUB_API_ORIGIN } from '../github-http.ts';

// `GET /repos/{owner}/{repo}/commits/{ref}` (E15-S05) of the mocked GitHub: the commits a test scripts for a repository (its history and
// the commits of its pull requests) are the ones it has. A repository the installation of the token does not reach is a 404, and a SHA
// no commit of a reachable repository has is a 422 ("No commit found for SHA"), as on GitHub.

/** What the route reads of the world of a test. */
interface CommitWorld {
  readonly scripted: ScriptedCommits;
  /** Whether the installation of the token of the request reaches the repository the path names. */
  readonly reaches: (request: Request, params: Record<string, unknown>) => boolean;
  /** The key of that repository in the world: `<installation>/<owner>/<name>`, in lower case. */
  readonly repository: (request: Request, params: Record<string, unknown>) => string;
}

/** The route of the world, to register with the others. */
export function commitRoute(world: CommitWorld) {
  return http.get(`${GITHUB_API_ORIGIN}/repos/:owner/:repo/commits/:sha`, ({ request, params }) => {
    if (!world.reaches(request, params)) {
      return HttpResponse.json({ message: 'Not Found' }, { status: 404 });
    }
    const sha = z.string().parse(params['sha']);
    return findCommit(world.scripted, world.repository(request, params), sha) === null
      ? HttpResponse.json({ message: `No commit found for SHA: ${sha}` }, { status: 422 })
      : HttpResponse.json({ sha, parents: [], files: [] });
  });
}
