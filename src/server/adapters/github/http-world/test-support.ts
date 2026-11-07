// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { onTestFinished } from 'vitest';
import { z } from 'zod';
import { type GithubId, parseGithubId } from '../../../../shared/github-id.ts';
import type { TestGitHubKey } from '../../../config/test-support.ts';
import { CheckRunStore, type CheckRunWriteRecord } from '../../../services/fake-check-runs/test-support.ts';
import { CommentIds, commentsOfIssue, postedComment } from '../../../services/fake-comments/test-support.ts';
import type { MembersProbeAnswer } from '../../../services/fake-github/test-support.ts';
import {
  type PublicMembers,
  scriptInto,
  scriptPublicMemberInto,
  type UserAccounts,
} from '../../../services/fake-user-accounts/test-support.ts';
import type { GitHubWorld } from '../../../services/github-contract/test-support.ts';
import type {
  GitHubClient,
  GitHubCommit,
  GitHubInstallation,
  GitHubIssueComment,
  GitHubOrgMembership,
  GitHubPullRequest,
  GitHubPullRequestRef,
  GitHubRepository,
  GitHubRepositoryPermission,
} from '../../../services/ports/github.ts';
import type { InstallationGate } from '../../../services/ports/installation-gate.ts';
import { FakeClock, FakeGate } from '../../../services/test-support.ts';
import { captureLogs, testConfig } from '../../../test-support.ts';
import { createLogger } from '../../http/logger.ts';
import { checkRoutes } from '../check-world/test-support.ts';
import { commitRoute } from '../commit-world/test-support.ts';
import { GITHUB_API_ORIGIN } from '../github-http.ts';
import {
  commentBody,
  commitBody,
  installationBody,
  pullRefBody,
  pullRequestBody,
  repositoryBody,
} from '../http-bodies/test-support.ts';
import { membersProbeRoute } from '../members-probe-fixture/test-support.ts';
import { guardPublicMembers } from '../public-members-guard/test-support.ts';
import { type Stall, stallNext } from '../stall-fixture/test-support.ts';
import { startGitHubApp } from '../start.ts';
import { APP_ID, appBody, hourlyTokens, jwtSignedBy, START } from '../test-support.ts';
import { organizationAccountRoute, publicMemberRoute, userAccountRoute } from '../user-account-fixture/test-support.ts';

// A GitHub at the HTTP boundary that behaves like the real one for the routes of the client port (E05-S04): MSW answers
// what the Octokit adapter sends, from state a test scripts through the same GitHubWorld the fake implements. Installation
// tokens identify their installation (`ghs_made-up-<installation>-<n>`), so a repository or a membership is visible to
// the installation that owns it and to no other, as on GitHub.

const PER_PAGE = 100;

/** The App that posts a comment in this world: the one `GET /app` answers with. */
const APP = parseGithubId(Number(APP_ID));

/** The installation a made-up token was minted for. */
const TOKEN_INSTALLATION = /^Bearer ghs_made-up-(\d+)-\d+$/;

/** Three base64url segments: what GitHub can decode before it checks the signature. */
const WELL_FORMED_JWT = /^[\w-]+\.[\w-]+\.[\w-]+$/;

interface Entry {
  installation: GitHubInstallation;
  repositories: GitHubRepository[];
}

/** What the routes read and what a test scripts. */
interface State {
  readonly entries: Map<GithubId, Entry>;
  readonly memberships: Map<string, GitHubOrgMembership>;
  readonly permissions: Map<string, GitHubRepositoryPermission>;
  readonly membersProbes: Map<GithubId, MembersProbeAnswer>;
  readonly userAccounts: UserAccounts;
  readonly publicMembers: PublicMembers;
  readonly pullRequests: Map<string, GitHubPullRequest>;
  readonly pullCommits: Map<string, readonly GitHubCommit[]>;
  readonly repositoryCommits: Map<string, readonly GitHubCommit[]>;
  readonly mergeBases: Map<string, string>;
  readonly comments: Map<string, GitHubIssueComment>;
  readonly commentIds: CommentIds;
  readonly commitPulls: Map<string, readonly GitHubPullRequestRef[]>;
  readonly checkRuns: CheckRunStore;
  readonly requests: string[];
  /** The next `GET /app/installations/{id}` is answered when this settles; `arrived` is called as it comes in. */
  stall?: Stall | undefined;
}

/** What a test can look at after the run. */
export interface HttpWorld extends GitHubWorld {
  /** `METHOD /path?query` of every request that reached GitHub since the App started, in order. */
  readonly requests: string[];
  /** Every Check Run write the mocked GitHub accepted (E14-S03), oldest first: what each run was sent, conclusion included. */
  readonly checkRunWrites: readonly CheckRunWriteRecord[];
}

/** One page of `items` and the `Link` header that leads to the next, like GitHub's. */
function pageOf<T>(url: URL, items: readonly T[]): { items: T[]; link: Record<string, string> } {
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'));
  const last = Math.max(1, Math.ceil(items.length / PER_PAGE));
  const at = (n: number): string => `${GITHUB_API_ORIGIN}${url.pathname}?per_page=${PER_PAGE}&page=${n}`;
  const link = page < last ? { link: `<${at(page + 1)}>; rel="next", <${at(last)}>; rel="last"` } : {};
  return { items: items.slice((page - 1) * PER_PAGE, page * PER_PAGE), link };
}

const notFound = (): Response => HttpResponse.json({ message: 'Not Found' }, { status: 404 });

const membershipKey = (installationId: unknown, org: string, login: string): string =>
  `${String(installationId)}/${org.toLowerCase()}/${login.toLowerCase()}`;

const permissionKey = (installationId: unknown, fullName: string, login: string): string =>
  `${String(installationId)}/${fullName.toLowerCase()}/${login.toLowerCase()}`;
/** `${installation}/${owner}/${repo}` with the names in lower case: GitHub does not tell `Acme/API` from `acme/api`. */
const repositoryKey = (installationId: unknown, owner: string, repo: string): string =>
  `${String(installationId)}/${owner.toLowerCase()}/${repo.toLowerCase()}`;

const idOf = (value: unknown): GithubId => parseGithubId(Number(z.string().parse(value)));

/** @throws Error for an installation the test never added. */
function known(state: State, githubInstallationId: GithubId): Entry {
  const entry = state.entries.get(githubInstallationId);
  if (entry === undefined) {
    throw new Error(`the world has no installation ${githubInstallationId}: add it first`);
  }
  return entry;
}

/** The installation a request's token was minted for (`Authorization: Bearer ghs_made-up-<installation>-<n>`). */
function installationOf(state: State, request: Request): Entry | undefined {
  const matched = TOKEN_INSTALLATION.exec(request.headers.get('authorization') ?? '');
  return matched === null ? undefined : state.entries.get(parseGithubId(Number(matched[1])));
}

// The routes stay in these functions: MSW's types contain `any`, which type-coverage would count in every test.

/** The routes the App itself uses: `GET /app`, one installation, and the list of installations. */
function appRoutes(state: State) {
  return [
    http.get(`${GITHUB_API_ORIGIN}/app`, () => HttpResponse.json(appBody())),
    http.get(`${GITHUB_API_ORIGIN}/app/installations/:id`, async ({ params }) => {
      const { stall } = state;
      state.stall = undefined;
      stall?.arrived();
      await stall?.released;
      const entry = state.entries.get(idOf(params['id']));
      return entry === undefined ? notFound() : HttpResponse.json(installationBody(entry.installation));
    }),
    http.get(`${GITHUB_API_ORIGIN}/app/installations`, ({ request }) => {
      const all = [...state.entries.values()].map((entry) => installationBody(entry.installation));
      const { items, link } = pageOf(new URL(request.url), all);
      return HttpResponse.json(items, { headers: link });
    }),
  ];
}

/** `POST /app/installations/{id}/access_tokens`: refused for a JWT the App's key did not sign, a stranger, a suspension. */
function tokenRoute(state: State, signer: TestGitHubKey, clock: FakeClock) {
  const issue = hourlyTokens(clock);
  return http.post(`${GITHUB_API_ORIGIN}/app/installations/:id/access_tokens`, ({ request, params }) => {
    const jwt = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
    const entry = state.entries.get(idOf(params['id']));
    if (!(WELL_FORMED_JWT.test(jwt) && jwtSignedBy(jwt, signer.publicKey))) {
      return HttpResponse.json({ message: 'A JSON web token could not be decoded' }, { status: 401 });
    }
    if (entry === undefined) {
      return notFound();
    }
    if (entry.installation.suspendedAt !== null) {
      return HttpResponse.json({ message: 'This installation has been suspended' }, { status: 403 });
    }
    return issue({ installationId: String(entry.installation.id), jwt, headers: request.headers, body: '' });
  });
}

/** The routes an installation token opens: its repositories, one repository, one membership, one repository permission. */
function installationRoutes(state: State) {
  return [
    http.get(`${GITHUB_API_ORIGIN}/installation/repositories`, ({ request }) => {
      const entry = installationOf(state, request);
      if (entry === undefined) {
        return HttpResponse.json({ message: 'Bad credentials' }, { status: 401 });
      }
      const { items, link } = pageOf(new URL(request.url), entry.repositories);
      const body = { total_count: entry.repositories.length, repositories: items.map(repositoryBody) };
      return HttpResponse.json(body, { headers: link });
    }),
    http.get(`${GITHUB_API_ORIGIN}/repositories/:id`, ({ request, params }) => {
      const wanted = idOf(params['id']);
      const found = installationOf(state, request)?.repositories.find((repository) => repository.id === wanted);
      return found === undefined ? notFound() : HttpResponse.json(repositoryBody(found));
    }),
    http.get(`${GITHUB_API_ORIGIN}/orgs/:org/memberships/:username`, ({ request, params }) => {
      const org = z.string().parse(params['org']);
      const login = z.string().parse(params['username']);
      const key = membershipKey(installationOf(state, request)?.installation.id, org, login);
      const membership = state.memberships.get(key);
      return membership === undefined
        ? notFound()
        : HttpResponse.json({
            state: membership.state,
            role: membership.role,
            user: { id: membership.userId, login },
          });
    }),
    http.get(`${GITHUB_API_ORIGIN}/repos/:owner/:repo/collaborators/:username/permission`, ({ request, params }) => {
      const owner = z.string().parse(params['owner']);
      const repo = z.string().parse(params['repo']);
      const login = z.string().parse(params['username']);
      const key = permissionKey(installationOf(state, request)?.installation.id, `${owner}/${repo}`, login);
      const answer = state.permissions.get(key);
      return answer === undefined
        ? notFound()
        : HttpResponse.json({
            permission: answer.permission,
            role_name: answer.permission,
            user: { id: answer.userId, login },
          });
    }),
  ];
}

/** The key of the repository of a request to `/repos/{owner}/{repo}/...`, as the installation of its token sees it: one no installation holds matches nothing. */
function repositoryOf(state: State, request: Request, params: Record<string, unknown>): string {
  const owner = z.string().parse(params['owner']);
  const repo = z.string().parse(params['repo']);
  return repositoryKey(installationOf(state, request)?.installation.id, owner, repo);
}

/** Whether the installation of the token of a request reaches the repository the path names (names compare without regard to case). */
function reaches(state: State, request: Request, params: Record<string, unknown>): boolean {
  const name = `${String(params['owner'])}/${String(params['repo'])}`.toLowerCase();
  return (
    installationOf(state, request)?.repositories.some((repository) => repository.fullName.toLowerCase() === name) ===
    true
  );
}

/**
 * `GET /repos/{owner}/{repo}/pulls?state=open` (E07-S08): the open pull requests scripted for the repository, newest first,
 * and a 404 for a repository the installation of the token does not reach.
 */
function openPullsRoute(state: State) {
  return http.get(`${GITHUB_API_ORIGIN}/repos/:owner/:repo/pulls`, ({ request, params }) => {
    if (!reaches(state, request, params)) {
      return notFound();
    }
    const prefix = `${repositoryOf(state, request, params)}#`;
    const open = [...state.pullRequests]
      .filter(([key, pull]) => key.startsWith(prefix) && pull.state === 'open')
      .map(([, pull]) => pull)
      .toSorted((a, b) => b.number - a.number);
    const { items, link } = pageOf(new URL(request.url), open);
    return HttpResponse.json(items.map(pullRefBody), { headers: link });
  });
}

/** The routes of the evaluation job (E07-S10): a pull request, its commits, the history behind a head, a comparison. */
function pullRoutes(state: State) {
  const commitsOf = (store: Map<string, readonly GitHubCommit[]>, key: string, request: Request) => {
    const commits = store.get(key);
    if (commits === undefined) {
      return notFound();
    }
    const { items, link } = pageOf(new URL(request.url), commits);
    return HttpResponse.json(items.map(commitBody), { headers: link });
  };
  return [
    http.get(`${GITHUB_API_ORIGIN}/repos/:owner/:repo/pulls/:number/commits`, ({ request, params }) => {
      const repository = repositoryOf(state, request, params);
      return commitsOf(state.pullCommits, `${repository}#${String(params['number'])}`, request);
    }),
    http.get(`${GITHUB_API_ORIGIN}/repos/:owner/:repo/pulls/:number`, ({ request, params }) => {
      const repository = repositoryOf(state, request, params);
      const found = state.pullRequests.get(`${repository}#${String(params['number'])}`);
      return found ? HttpResponse.json(pullRequestBody(found)) : notFound();
    }),
    openPullsRoute(state),
    http.get(`${GITHUB_API_ORIGIN}/repos/:owner/:repo/commits`, ({ request, params }) =>
      commitsOf(state.repositoryCommits, repositoryOf(state, request, params), request),
    ),
    http.get(`${GITHUB_API_ORIGIN}/repos/:owner/:repo/compare/:basehead`, ({ request, params }) => {
      const repository = repositoryOf(state, request, params);
      const mergeBase = state.mergeBases.get(`${repository}@${String(params['basehead'])}`);
      return mergeBase ? HttpResponse.json({ merge_base_commit: { sha: mergeBase }, status: 'diverged' }) : notFound();
    }),
  ];
}

/** The routes of the manual re-evaluation (E07-S07): a comment, and the pull requests of a commit; and (E09-S06) the rewrite of a comment. */
function commentRoutes(state: State) {
  return [
    http.patch(`${GITHUB_API_ORIGIN}/repos/:owner/:repo/issues/comments/:id`, async ({ request, params }) => {
      const { body } = z.object({ body: z.string() }).parse(await request.json());
      const key = `${repositoryOf(state, request, params)}/comments/${String(params['id'])}`;
      const found = state.comments.get(key);
      if (found === undefined || !reaches(state, request, params)) {
        return notFound();
      }
      const rewritten = { ...found, body };
      state.comments.set(key, rewritten);
      return HttpResponse.json(commentBody(rewritten, `${String(params['owner'])}/${String(params['repo'])}`));
    }),
    http.get(`${GITHUB_API_ORIGIN}/repos/:owner/:repo/issues/comments/:id`, ({ request, params }) => {
      const found = state.comments.get(`${repositoryOf(state, request, params)}/comments/${String(params['id'])}`);
      const name = `${String(params['owner'])}/${String(params['repo'])}`;
      return found ? HttpResponse.json(commentBody(found, name)) : notFound();
    }),
    http.get(`${GITHUB_API_ORIGIN}/repos/:owner/:repo/commits/:sha/pulls`, ({ request, params }) => {
      const found = state.commitPulls.get(`${repositoryOf(state, request, params)}/commits/${String(params['sha'])}`);
      return found ? HttpResponse.json(found.map(pullRefBody)) : notFound();
    }),
  ];
}

/** The routes of the comment the platform keeps on a pull request (E09-S07): the comments of an issue, and a new one posted by the App. */
function conversationRoutes(state: State) {
  const issueOf = (params: Record<string, unknown>): number => Number(params['number']);
  const prefixOf = (request: Request, params: Record<string, unknown>): string =>
    `${repositoryOf(state, request, params)}/comments/`;
  return [
    http.get(`${GITHUB_API_ORIGIN}/repos/:owner/:repo/issues/:number/comments`, ({ request, params }) => {
      if (!reaches(state, request, params)) {
        return notFound();
      }
      const found = commentsOfIssue(state.comments, prefixOf(request, params), issueOf(params));
      const { items, link } = pageOf(new URL(request.url), found);
      const name = `${String(params['owner'])}/${String(params['repo'])}`;
      return HttpResponse.json(
        items.map((comment) => commentBody(comment, name)),
        { headers: link },
      );
    }),
    http.post(`${GITHUB_API_ORIGIN}/repos/:owner/:repo/issues/:number/comments`, async ({ request, params }) => {
      const { body } = z.object({ body: z.string() }).parse(await request.json());
      if (!reaches(state, request, params)) {
        return notFound();
      }
      const posted = postedComment({ id: state.commentIds.take(), issueNumber: issueOf(params), appId: APP }, body);
      state.comments.set(`${prefixOf(request, params)}${posted.id}`, posted);
      return HttpResponse.json(commentBody(posted, `${String(params['owner'])}/${String(params['repo'])}`), {
        status: 201,
      });
    }),
  ];
}

/** Starts MSW with these routes until the test ends; every request is noted in `state.requests`. */
function serve(state: State, signer: TestGitHubKey, clock: FakeClock): void {
  const heldToken = (request: Request): boolean => installationOf(state, request) !== undefined;
  const server = setupServer(
    http.all('*', ({ request }) => {
      const url = new URL(request.url);
      state.requests.push(`${request.method} ${url.pathname}${url.search}`);
      return undefined;
    }),
    ...appRoutes(state),
    tokenRoute(state, signer, clock),
    ...installationRoutes(state),
    membersProbeRoute({
      answers: state.membersProbes,
      reached: (request) => installationOf(state, request)?.installation,
    }),
    userAccountRoute({ accounts: state.userAccounts, known: heldToken }),
    organizationAccountRoute({ accounts: state.userAccounts, known: heldToken }),
    publicMemberRoute({ members: state.publicMembers, known: heldToken }),
    ...pullRoutes(state),
    commitRoute({
      scripted: state,
      reaches: (request, params) => reaches(state, request, params),
      repository: (request, params) => repositoryOf(state, request, params),
    }),
    ...commentRoutes(state),
    ...conversationRoutes(state),
    ...checkRoutes({ store: state.checkRuns, reached: (request) => installationOf(state, request) }),
    guardPublicMembers().handler,
  );
  server.listen({ onUnhandledFrame: 'error' });
  onTestFinished(() => {
    server.close();
  });
}

/** The key of a repository given as `owner/name`. */
function keyOf(githubInstallationId: GithubId, fullName: string): string {
  const [owner = '', repo = ''] = fullName.split('/');
  return repositoryKey(githubInstallationId, owner, repo);
}

/** The scripting half of the world: what a test changes while the routes read it. */
function scripting(state: State, gate: FakeGate): Omit<GitHubWorld, 'client'> {
  return {
    addInstallation: (installation, repositories = []) => {
      state.entries.set(installation.id, { installation, repositories: [...repositories] });
    },
    suspend: (githubInstallationId, at) => {
      const entry = known(state, githubInstallationId);
      entry.installation = { ...entry.installation, suspendedAt: at };
    },
    addMembership: (githubInstallationId, org, login, membership) => {
      state.memberships.set(membershipKey(githubInstallationId, org, login), membership);
    },
    addRepositoryPermission: (githubInstallationId, fullName, login, permission) => {
      state.permissions.set(permissionKey(githubInstallationId, fullName, login), permission);
    },
    scriptMembersProbe: (githubInstallationId, answer) => {
      state.membersProbes.set(githubInstallationId, answer);
    },
    scriptUserAccount: scriptInto(state.userAccounts),
    scriptPublicMember: scriptPublicMemberInto(state.publicMembers),
    addPullRequest: (githubInstallationId, fullName, pullRequest) => {
      state.pullRequests.set(`${keyOf(githubInstallationId, fullName)}#${pullRequest.number}`, pullRequest);
    },
    setPullRequestCommits: (githubInstallationId, fullName, prNumber, commits) => {
      state.pullCommits.set(`${keyOf(githubInstallationId, fullName)}#${prNumber}`, commits);
    },
    setRepositoryCommits: (githubInstallationId, fullName, commits) => {
      state.repositoryCommits.set(keyOf(githubInstallationId, fullName), commits);
    },
    setMergeBase: (githubInstallationId, fullName, { baseSha, headSha }, mergeBaseSha) => {
      state.mergeBases.set(`${keyOf(githubInstallationId, fullName)}@${baseSha}...${headSha}`, mergeBaseSha);
    },
    addIssueComment: (githubInstallationId, fullName, comment) => {
      state.comments.set(`${keyOf(githubInstallationId, fullName)}/comments/${comment.id}`, comment);
    },
    setCommitPullRequests: (githubInstallationId, fullName, headSha, pulls) => {
      state.commitPulls.set(`${keyOf(githubInstallationId, fullName)}/commits/${headSha}`, pulls);
    },
    addCheckRun: (githubInstallationId, fullName, run) => {
      state.checkRuns.seed({ installationId: githubInstallationId, fullName }, run);
    },
    refuse: (githubInstallationId, reason) => {
      gate.refuse(githubInstallationId, reason);
    },
    reached: () => state.requests.length,
    stallGetInstallation: () => stallNext(state),
  };
}

/** The routes, the real adapter wiring and the client, behind `gate`. Requests are counted from after the self-check. */
async function startWorld(
  signer: TestGitHubKey,
  gate: InstallationGate,
): Promise<{ client: GitHubClient; state: State }> {
  const state: State = {
    entries: new Map(),
    memberships: new Map(),
    permissions: new Map(),
    membersProbes: new Map(),
    userAccounts: new Map(),
    publicMembers: new Map(),
    pullRequests: new Map(),
    pullCommits: new Map(),
    repositoryCommits: new Map(),
    mergeBases: new Map(),
    comments: new Map(),
    commentIds: new CommentIds(),
    commitPulls: new Map(),
    checkRuns: new CheckRunStore(),
    requests: [],
  };
  const clock = new FakeClock(START);
  serve(state, signer, clock);
  const app = await startGitHubApp({
    config: testConfig({ GITHUB_APP_ID: APP_ID, GITHUB_APP_PRIVATE_KEY: signer.pem }),
    logger: createLogger({ logLevel: 'info' }, captureLogs().destination),
    clock,
    fetch,
    gate,
  });
  // The start-up self-check (GET /app) is the App's own; what a test counts begins after it.
  state.requests.length = 0;
  const { client } = z.object({ client: z.custom<GitHubClient>() }).parse(app);
  return { client, state };
}

/**
 * Starts MSW with the routes, the real adapter wiring (`startGitHubApp`: signer, identity check, token provider, Octokit
 * client) and a gate the test can close for an installation. `signer` signs the App's JWTs; the mocked GitHub accepts it.
 */
export async function httpWorld(signer: TestGitHubKey): Promise<HttpWorld> {
  const gate = new FakeGate();
  const { client, state } = await startWorld(signer, gate);
  return { client, requests: state.requests, checkRunWrites: state.checkRuns.writes, ...scripting(state, gate) };
}

/** The world behind a gate of the test's own, for example the stored gate of E05-S07: the installations are scripted, the gate is not. */
export async function gatedHttpWorld(
  signer: TestGitHubKey,
  gate: InstallationGate,
): Promise<Pick<HttpWorld, 'addInstallation' | 'client' | 'requests'>> {
  const { client, state } = await startWorld(signer, gate);
  const { addInstallation } = scripting(state, new FakeGate());
  return { client, requests: state.requests, addInstallation };
}
