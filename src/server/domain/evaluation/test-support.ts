// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { ActorExtraction, ExtractedActor, UnlinkedFinding, UnlinkedRole } from './actor-types.ts';
import { evaluatePullRequest } from './evaluate.ts';
import { GITHUB_WEB_FLOW_ID } from './github-identities.ts';
import { collectRepoWalk, type RepoWalkResult, type WalkCommit } from './repo-walk.ts';
import { toStoredDetails } from './stored-details.ts';
import type {
  Account,
  AccountType,
  AllowlistEntry,
  AllowlistKind,
  AllowlistScope,
  CommitFacts,
  CorporateCover,
  EvaluationInput,
  RawIdentity,
  Role,
  SignatureFact,
} from './types.ts';

// Builders for the tests of src/server/domain/evaluation. They are plain data with sensible defaults, so a test names
// only what it is about. Nothing here is random and nothing reads a clock: a fixture is the same on every run.

/** A lower-case 40-character commit SHA made from a number: `sha(1)` is 39 zeros and a 1. */
export function sha(n: number): string {
  return n.toString(16).padStart(40, '0');
}

export function account(id: number, type: AccountType = 'User'): Account {
  return { id, type };
}

/** A single-parent commit by `author`, committed by the same account, with an empty message. */
export function commitFacts(n: number, overrides: Partial<CommitFacts> = {}): CommitFacts {
  const author = account(n);
  return {
    sha: sha(n),
    parents: [sha(n - 1)],
    author,
    committer: author,
    message: `change ${n}`,
    rawAuthor: { name: `Author ${n}`, email: `author${n}@example.org` },
    rawCommitter: { name: `Author ${n}`, email: `author${n}@example.org` },
    ...overrides,
  };
}

/** An allowlist entry; by default one of the repository itself. `githubId` is a user, a bot or an organisation id. */
export function allowlistEntry(
  id: number,
  kind: AllowlistKind,
  githubId: number,
  scope: AllowlistScope = 'repository',
): AllowlistEntry {
  return { id, kind, githubId, scope };
}

/** A signature of `githubId` that covers the default policy of `evaluationInput` (document 1, major 1), not revoked. */
export function signatureFact(id: number, githubId: number, overrides: Partial<SignatureFact> = {}): SignatureFact {
  return { id, githubId, documentId: 1, versionId: 1000 + id, major: 1, revoked: false, ...overrides };
}

/** An actor as extraction would hand it over: one account with its roles and no commits unless the test names some. */
export function extractedActor(
  id: number,
  type: AccountType = 'User',
  roles: readonly Role[] = ['author'],
  shas: readonly string[] = [],
): ExtractedActor {
  return { account: account(id, type), roles, shas };
}

/** The approvals that cover people (E21-S05): `corporateCover([10, 4, 7])` says user 10 is covered by approval 7 of agreement 4. */
export function corporateCover(
  ...covers: readonly (readonly [githubId: number, agreementId: number, approvalId: number])[]
): ReadonlyMap<number, CorporateCover> {
  return new Map(covers.map(([githubId, agreementId, approvalId]) => [githubId, { agreementId, approvalId }]));
}

/** Known organisation members: `membership([500, [10, 11]])` says users 10 and 11 belong to organisation 500. */
export function membership(
  ...orgs: readonly (readonly [orgId: number, userIds: readonly number[]])[]
): ReadonlyMap<number, ReadonlySet<number>> {
  return new Map(orgs.map(([orgId, userIds]): [number, ReadonlySet<number>] => [orgId, new Set(userIds)]));
}

/** An open pull request by user 1 with no commits, a CLA at document 1 major 1, and no signatures or allowlist. */
export function evaluationInput(overrides: Partial<EvaluationInput> = {}): EvaluationInput {
  return {
    headSha: sha(1),
    opener: account(1),
    commits: [],
    listing: 'complete',
    policy: { documentId: 1, activeMajor: 1 },
    signatures: [],
    allowlist: [],
    orgMembers: new Map(),
    overrides: new Map(),
    corporateCovered: new Map(),
    corporateOutdated: new Set(),
    ...overrides,
  };
}

/** An unlinked finding as extraction would hand it over, with a made-up display identity unless the test names one. */
export function unlinkedFinding(
  commitSha: string,
  role: UnlinkedRole,
  raw: RawIdentity = { name: 'Unlinked Person', email: 'unlinked@example.org' },
): UnlinkedFinding {
  return { sha: commitSha, role, raw };
}

/** What most extraction tests compare: the id, roles and commits of every actor, in output order. */
export function actorRows(
  extraction: ActorExtraction,
): readonly { readonly id: number; readonly roles: readonly Role[]; readonly shas: readonly string[] }[] {
  return extraction.actors.map((actor) => ({ id: actor.account.id, roles: actor.roles, shas: actor.shas }));
}

/** A small seeded generator (mulberry32): numbers in [0, 1) that are the same on every run for the same seed. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A copy of `items` in an order fixed by `seed`: every item gets a key from a small seeded generator and the copy is
 * sorted by key, so a test can shuffle its input and still be the same on every run.
 */
export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const next = seededRandom(seed);
  return items
    .map((item) => ({ item, key: next() }))
    .sort((a, b) => a.key - b.key)
    .map((keyed) => keyed.item);
}

/** `ID+login@users.noreply.github.com`, the address a `Co-authored-by` trailer resolves from (E08-S06). */
export function noreplyEmail(id: number | string, login = 'someone'): string {
  return `${id}+${login}@users.noreply.github.com`;
}

/** A trailer line as git writes it. The key is a parameter because its case is a rule of its own. */
export function coAuthoredBy(email: string, name = 'Some Person', key = 'Co-authored-by'): string {
  return `${key}: ${name} <${email}>`;
}

/** A commit message with a subject, a body paragraph and a final paragraph made of `lines`. */
export function messageEndingWith(...lines: readonly string[]): string {
  return ['Subject line', '', 'Body paragraph.', '', ...lines].join('\n');
}

/** A commit for the repo walk: `walkCommit(5, 4)` is commit 5 with parent 4, `walkCommit(1)` is a root commit. */
export function walkCommit(n: number, ...parents: readonly number[]): WalkCommit {
  return { sha: sha(n), parents: parents.map(sha) };
}

/** A straight line of commits `from` to `to`: each one has the one before it as its parent, `from` has `from - 1`. */
export function line(from: number, to: number): WalkCommit[] {
  return Array.from({ length: to - from + 1 }, (_unused, index) => walkCommit(from + index, from + index - 1));
}

/** Cuts a list into pages of `size` (GitHub's 100 by default); the last page may be shorter. */
export function paged<T>(items: readonly T[], size = 100): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_unused, page) =>
    items.slice(page * size, (page + 1) * size),
  );
}

/**
 * The repo walk loop of E07-S04 in miniature: fetches `pages` one after the other, asks `collectRepoWalk` after each
 * and stops at the first answer that is not `need_next_page`. `exhausted` is true once the last page is in.
 */
export function driveWalk(
  pages: readonly (readonly WalkCommit[])[],
  headSha: string,
  mergeBaseSha: string,
): { readonly result: RepoWalkResult; readonly pagesFetched: number } {
  const ask = (pagesFetched: number): RepoWalkResult =>
    collectRepoWalk({
      headSha,
      mergeBaseSha,
      commits: pages.slice(0, pagesFetched).flat(),
      pagesFetched,
      exhausted: pagesFetched > 0 && pagesFetched >= pages.length,
    });
  let pagesFetched = 0;
  let result = ask(pagesFetched);
  while (result.status === 'need_next_page') {
    pagesFetched += 1;
    result = ask(pagesFetched);
  }
  return { result, pagesFetched };
}

/** Author of commit `i` of the 50-commit fixture: people 2 to 10, every 10th a bot (900 to 902), every 11th unlinked. */
function fixtureAuthor(i: number): Account | null {
  if (i % 11 === 0) {
    return null;
  }
  return i % 10 === 0 ? account(900 + (i % 3), 'Bot') : account(2 + (i % 9));
}

/** Committer of commit `i`: unlinked every 13th, `web-flow` every 5th, a third party (20 to 22) every 7th, else the author. */
function fixtureCommitter(i: number, author: Account | null): Account | null {
  if (i % 13 === 0) {
    return null;
  }
  if (i % 5 === 0) {
    return account(GITHUB_WEB_FLOW_ID);
  }
  return i % 7 === 0 ? account(20 + (i % 3)) : author;
}

/** Every 6th commit names co-author 30 to 33 by a noreply trailer, every 8th an address that cannot be resolved. */
function fixtureMessage(i: number): string {
  if (i % 6 === 0) {
    return messageEndingWith(coAuthoredBy(noreplyEmail(30 + ((i / 6) % 4), 'pair')));
  }
  return i % 8 === 0 ? messageEndingWith(coAuthoredBy('pair@example.org')) : `change ${i}`;
}

function fixtureCommit(i: number): CommitFacts {
  const author = fixtureAuthor(i);
  return commitFacts(100 + i, {
    author,
    committer: fixtureCommitter(i, author),
    parents: i % 17 === 0 ? [sha(98 + i), sha(97 + i)] : [sha(99 + i)],
    message: fixtureMessage(i),
  });
}

/**
 * A pull request of 50 commits by 40-odd shapes of identity: signed, unsigned, allowlisted, org members, bots, unlinked,
 * `web-flow`, merges, trailers and one commit listed twice, against a policy of document 1 at major 1. Signatures include
 * two for user 2 (the lowest id is the basis), an old major, a revoked one and one with a bot's id; the allowlist has the
 * same id under two scopes and two kinds. It fails, and it is the input that the order-independence tests shuffle.
 */
export function fiftyCommitInput(): EvaluationInput {
  return evaluationInput({
    commits: [...Array.from({ length: 50 }, (_unused, index) => fixtureCommit(index + 1)), fixtureCommit(7)],
    signatures: [
      ...[2, 3, 4, 5, 1, 30, 31].map((githubId, index) => signatureFact(8 + index, githubId)),
      signatureFact(40, 2),
      signatureFact(41, 9, { major: 0 }),
      signatureFact(42, 10, { revoked: true }),
      signatureFact(43, 901),
    ],
    allowlist: [
      allowlistEntry(1, 'user', 7),
      allowlistEntry(2, 'user', 7, 'installation'),
      allowlistEntry(3, 'org_members', 500, 'installation'),
      allowlistEntry(4, 'bot', 900),
      allowlistEntry(5, 'bot', 901, 'installation'),
      allowlistEntry(6, 'user', 901),
    ],
    orgMembers: membership([500, [8, 20]]),
    overrides: new Map([
      [sha(111), 77],
      [sha(122).toUpperCase(), 78],
      [sha(9999), 79],
    ]),
  });
}

/** A SHA without its leading zeros (`sha(2)` reads `2`), so a golden line stays short. Any other value is printed as is. */
function plain(value: string | number | null): string {
  return typeof value === 'string' ? value.replace(/^0+/, '') : String(value);
}

function overrideLine(overrideId: number | null): string {
  return overrideId === null ? 'open' : `override ${overrideId}`;
}

type StoredDetails = ReturnType<typeof toStoredDetails>;

function basisLine(basis: StoredDetails['actors'][number]['basis']): string {
  if (basis === null) {
    return 'uncovered';
  }
  switch (basis.kind) {
    case 'signature':
      return `covered by signature ${basis.signatureId} (version ${basis.versionId}, major ${basis.major})`;
    case 'allowlist':
      return `covered by allowlist entry ${basis.entryId} (${basis.entryKind}, ${basis.scope})`;
    case 'corporate_approval':
      return `covered by corporate approval ${basis.approvalId} (agreement ${basis.agreementId})`;
  }
}

/**
 * What a golden scenario snapshots, one line per fact: the header, every actor with its basis, every unlinked finding,
 * every advisory and every fix. It is the stored details plus the fixes, so the whole verdict is in it, and nothing else
 * is: the display-only raw identities are no part of the verdict. A change to any rule shows up as a reviewable diff.
 */
export function verdictLines(input: EvaluationInput): string[] {
  const evaluation = evaluatePullRequest(input);
  const details = toStoredDetails(evaluation);
  return [
    `${details.outcome}: ${details.failureCodes.join(', ') || 'no failure code'}`,
    `document ${plain(details.documentId)}, major ${plain(details.activeMajor)}, listing ${details.listing}`,
    `${details.commitCount} commits, ${details.mergeCommitsSkipped} merge commits skipped`,
    ...details.actors.map((actor) => `actor ${actor.githubId} ${actor.roles.join('+')}: ${basisLine(actor.basis)}`),
    ...details.unlinked.map((found) => `unlinked ${plain(found.sha)} ${found.role}: ${overrideLine(found.overrideId)}`),
    ...details.advisories.map((advisory) => `advisory ${advisory.code} ${plain(advisory.sha)}`),
    ...evaluation.fixes.map((fix) => `fix ${Object.values(fix).map(plain).join(' ')}`),
  ];
}
