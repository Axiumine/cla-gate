// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { HttpResponse, http } from 'msw';
import { z } from 'zod';
import { CHECK_RUN_NAME } from '../../../../shared/check.ts';
import { parseGithubId } from '../../../../shared/github-id.ts';
import {
  type CheckRunStore,
  lacksConclusion,
  type RepositoryRef,
} from '../../../services/fake-check-runs/test-support.ts';
import type { CheckRunWrite, GitHubCheckRun, GitHubRepository } from '../../../services/ports/github.ts';
import { GITHUB_API_ORIGIN } from '../github-http.ts';

// The Check Run routes of the mocked GitHub (E09-S05): the four calls of the Check Run writer, answered from a store that
// `FakeGitHub` shares, so the adapter and the fake meet one set of rules. A request whose token does not reach the repository is
// a 404, as it is on GitHub, and a `completed` run without a conclusion is a 422.

/** The App that posts a run in this world: the one `GET /app` answers with. */
const APP = parseGithubId(4242);

/** The body of a `POST` or `PATCH`, as the adapter spells it (`name` and `head_sha` are the `POST`'s). */
const writeBody = z.object({
  head_sha: z.string().optional(),
  status: z.enum(['in_progress', 'completed']),
  conclusion: z.enum(['success', 'failure', 'neutral', 'cancelled']).optional(),
  started_at: z.iso.datetime().optional(),
  completed_at: z.iso.datetime().optional(),
  external_id: z.string().optional(),
  details_url: z.string().optional(),
  output: z.object({ title: z.string(), summary: z.string(), text: z.string().optional() }),
});

/** A Check Run as GitHub spells it, with fields the platform does not use. */
function runBody(run: GitHubCheckRun): Record<string, unknown> {
  return {
    id: run.id,
    head_sha: run.headSha,
    name: CHECK_RUN_NAME,
    status: run.status,
    conclusion: null,
    external_id: run.externalId,
    app: run.appId === null ? null : { id: run.appId, slug: 'cla-gate-test', name: 'CLA Gate Test' },
    html_url: 'https://github.com/x',
  };
}

const notFound = (): Response => HttpResponse.json({ message: 'Not Found' }, { status: 404 });
const unprocessable = (): Response => HttpResponse.json({ message: 'Validation Failed' }, { status: 422 });

/** The write a body makes: the times are dates, an absent field is absent. */
function writeOf(body: z.infer<typeof writeBody>): CheckRunWrite {
  const { output } = body;
  return {
    status: body.status,
    title: output.title,
    summary: output.summary,
    ...(output.text === undefined ? {} : { text: output.text }),
    ...(body.conclusion === undefined ? {} : { conclusion: body.conclusion }),
    ...(body.started_at === undefined ? {} : { startedAt: new Date(body.started_at) }),
    ...(body.completed_at === undefined ? {} : { completedAt: new Date(body.completed_at) }),
    ...(body.external_id === undefined ? {} : { externalId: body.external_id }),
    ...(body.details_url === undefined ? {} : { detailsUrl: body.details_url }),
  };
}

/** The installation and repositories of the token a request carries; undefined for a request that has none. */
type Reached =
  | { readonly installation: { readonly id: number }; readonly repositories: readonly GitHubRepository[] }
  | undefined;

/** What the routes need of the world around them. */
export interface CheckRouteWorld {
  readonly store: CheckRunStore;
  readonly reached: (request: Request) => Reached;
}

/** The repository of a request, or undefined when the token of the request does not reach it. */
function repositoryOf(
  world: CheckRouteWorld,
  request: Request,
  params: Record<string, unknown>,
): RepositoryRef | undefined {
  const fullName = `${String(params['owner'])}/${String(params['repo'])}`;
  const entry = world.reached(request);
  const known = entry?.repositories.some((repository) => repository.fullName.toLowerCase() === fullName.toLowerCase());
  return entry === undefined || known !== true
    ? undefined
    : { installationId: parseGithubId(entry.installation.id), fullName };
}

const checkRunId = (params: Record<string, unknown>) => parseGithubId(Number(params['id']));

/** `POST .../check-runs` and `PATCH .../check-runs/{id}`. */
function writeRoutes(world: CheckRouteWorld) {
  return [
    http.post(`${GITHUB_API_ORIGIN}/repos/:owner/:repo/check-runs`, async ({ request, params }) => {
      const body = writeBody.required({ head_sha: true }).parse(await request.json());
      const repository = repositoryOf(world, request, params);
      const write = writeOf(body);
      if (repository === undefined) {
        return notFound();
      }
      return lacksConclusion(write)
        ? unprocessable()
        : HttpResponse.json(runBody(world.store.create(repository, APP, body.head_sha, write)), { status: 201 });
    }),
    http.patch(`${GITHUB_API_ORIGIN}/repos/:owner/:repo/check-runs/:id`, async ({ request, params }) => {
      const write = writeOf(writeBody.parse(await request.json()));
      const repository = repositoryOf(world, request, params);
      if (repository === undefined) {
        return notFound();
      }
      const run = lacksConclusion(write) ? undefined : world.store.update(repository, checkRunId(params), write);
      if (run === undefined) {
        return lacksConclusion(write) ? unprocessable() : notFound();
      }
      return HttpResponse.json(runBody(run));
    }),
  ];
}

/** `GET .../check-runs/{id}` and the listing of a commit. */
function readRoutes(world: CheckRouteWorld) {
  return [
    http.get(`${GITHUB_API_ORIGIN}/repos/:owner/:repo/check-runs/:id`, ({ request, params }) => {
      const repository = repositoryOf(world, request, params);
      const run = repository && world.store.find(repository, checkRunId(params));
      return run ? HttpResponse.json(runBody(run)) : notFound();
    }),
    http.get(`${GITHUB_API_ORIGIN}/repos/:owner/:repo/commits/:sha/check-runs`, ({ request, params }) => {
      const repository = repositoryOf(world, request, params);
      if (repository === undefined) {
        return notFound();
      }
      const runs = world.store.latest(repository, String(params['sha']));
      return HttpResponse.json({ total_count: runs.length, check_runs: runs.map(runBody) });
    }),
  ];
}

/** The four routes of the Check Run writer. */
export function checkRoutes(world: CheckRouteWorld) {
  return [...writeRoutes(world), ...readRoutes(world)];
}
