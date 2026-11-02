// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { onTestFinished } from 'vitest';
import { z } from 'zod';
import { type GithubId, parseGithubId } from '../../../../shared/github-id.ts';
import type { TestGitHubKey } from '../../../config/test-support.ts';
import type { GitHubWorld } from '../../../services/github-contract/test-support.ts';
import type {
  GitHubClient,
  GitHubInstallation,
  GitHubOrgMembership,
  GitHubRepository,
  GitHubRepositoryPermission,
} from '../../../services/ports/github.ts';
import type { InstallationGate } from '../../../services/ports/installation-gate.ts';
import { FakeClock, FakeGate } from '../../../services/test-support.ts';
import { captureLogs, testConfig } from '../../../test-support.ts';
import { createLogger } from '../../http/logger.ts';
import { GITHUB_API_ORIGIN } from '../github-http.ts';
import { startGitHubApp } from '../start.ts';
import { APP_ID, appBody, hourlyTokens, jwtSignedBy, START } from '../test-support.ts';

// A GitHub at the HTTP boundary that behaves like the real one for the routes of the client port (E05-S04): MSW answers
// what the Octokit adapter sends, from state a test scripts through the same GitHubWorld the fake implements. Installation
// tokens identify their installation (`ghs_made-up-<installation>-<n>`), so a repository or a membership is visible to
// the installation that owns it and to no other, as on GitHub.

const PER_PAGE = 100;

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
  readonly requests: string[];
}

/** What a test can look at after the run. */
export interface HttpWorld extends GitHubWorld {
  /** `METHOD /path?query` of every request that reached GitHub since the App started, in order. */
  readonly requests: string[];
}

/** An installation as GitHub spells it, with fields the platform does not use. */
function installationBody(installation: GitHubInstallation): Record<string, unknown> {
  return {
    id: installation.id,
    account: { ...installation.account, node_id: 'MDEyOk9yZ2FuaXphdGlvbg==', site_admin: false },
    app_id: 4242,
    repository_selection: 'all',
    suspended_at: installation.suspendedAt === null ? null : installation.suspendedAt.toISOString(),
    suspended_by: null,
    permissions: installation.permissions,
    events: ['pull_request'],
  };
}

function repositoryBody(repository: GitHubRepository): Record<string, unknown> {
  const [owner = 'unknown', name = 'unknown'] = repository.fullName.split('/');
  return {
    id: repository.id,
    name,
    full_name: repository.fullName,
    private: true,
    owner: { login: owner, id: 1, type: 'Organization' },
    default_branch: 'main',
  };
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
    http.get(`${GITHUB_API_ORIGIN}/app/installations/:id`, ({ params }) => {
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

/** Starts MSW with these routes until the test ends; every request is noted in `state.requests`. */
function serve(state: State, signer: TestGitHubKey, clock: FakeClock): void {
  const server = setupServer(
    http.all('*', ({ request }) => {
      const url = new URL(request.url);
      state.requests.push(`${request.method} ${url.pathname}${url.search}`);
      return undefined;
    }),
    ...appRoutes(state),
    tokenRoute(state, signer, clock),
    ...installationRoutes(state),
  );
  server.listen({ onUnhandledFrame: 'error' });
  onTestFinished(() => {
    server.close();
  });
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
    refuse: (githubInstallationId, reason) => {
      gate.refuse(githubInstallationId, reason);
    },
    reached: () => state.requests.length,
  };
}

/** The routes, the real adapter wiring and the client, behind `gate`. Requests are counted from after the self-check. */
async function startWorld(
  signer: TestGitHubKey,
  gate: InstallationGate,
): Promise<{ client: GitHubClient; state: State }> {
  const state: State = { entries: new Map(), memberships: new Map(), permissions: new Map(), requests: [] };
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
  return { client, requests: state.requests, ...scripting(state, gate) };
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
