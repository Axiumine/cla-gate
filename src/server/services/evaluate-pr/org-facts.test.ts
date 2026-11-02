// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test, vi } from 'vitest';
import { parseGithubId } from '../../../shared/github-id.ts';
import type { AllowlistEntry, ExtractedActor } from '../../domain/evaluation/index.ts';
import type { OrgMembership, OrgMembershipVerdict } from '../org-membership.ts';
import { type Candidate, lookupCandidates, readOrgMembers } from './org-facts.ts';

// Who is asked about, and how the answers become the facts of the engine (E07-S04).

const ORG = 7000;
const INSTALLATION = parseGithubId(5000);
const EXEMPT_ORG: AllowlistEntry = { id: 1, kind: 'org_members', githubId: ORG, scope: 'installation' };

const person = (id: number): Candidate => ({ id: parseGithubId(id), login: `user-${id}` });
const actor = (id: number, type: ExtractedActor['account']['type'] = 'User'): ExtractedActor => ({
  account: { id, type },
  roles: ['author'],
  shas: [],
});
const seen = (...ids: number[]) => new Map(ids.map((id) => [id, person(id)]));

const base = {
  actors: [actor(1), actor(2)],
  allowlist: [EXEMPT_ORG],
  signed: new Set<number>(),
  seen: seen(1, 2),
  orgId: ORG,
};

test('every person is a candidate when the organisation is exempt and nobody is signed or allowlisted', () => {
  expect(lookupCandidates(base).map((candidate) => candidate.id)).toEqual([1, 2]);
});

test('nobody is a candidate when the allowlist does not exempt the members of the organisation', () => {
  expect(lookupCandidates({ ...base, allowlist: [] })).toEqual([]);
  expect(lookupCandidates({ ...base, allowlist: [{ ...EXEMPT_ORG, githubId: 1 }] })).toEqual([]);
  expect(lookupCandidates({ ...base, allowlist: [{ ...EXEMPT_ORG, kind: 'user' }] })).toEqual([]);
});

test('a signed person, an allowlisted user and an allowlisted bot are covered already, so they are not candidates', () => {
  const facts = {
    ...base,
    actors: [actor(1), actor(2), actor(3), actor(4)],
    seen: seen(1, 2, 3, 4),
    signed: new Set([1]),
    allowlist: [EXEMPT_ORG, { id: 2, kind: 'user' as const, githubId: 2, scope: 'repository' as const }],
  };
  expect(lookupCandidates(facts).map((candidate) => candidate.id)).toEqual([3, 4]);
});

test.each(['Bot', 'Organization', 'Mannequin'] as const)(
  'an account of the type %s is not a person to look up',
  (type) => {
    expect(lookupCandidates({ ...base, actors: [actor(1, type)] })).toEqual([]);
  },
);

test('a person the job saw under no login cannot be looked up', () => {
  expect(lookupCandidates({ ...base, seen: seen(1) }).map((candidate) => candidate.id)).toEqual([1]);
});

/** A membership service that answers from a script and notes how many lookups run at once and whom it was asked about. */
function scripted(verdicts: ReadonlyMap<number, OrgMembershipVerdict> = new Map()) {
  let active = 0;
  const asked: number[] = [];
  const state = { peak: 0, asked };
  const isOrgMember = vi.fn<OrgMembership['isOrgMember']>(async ({ userGithubId }) => {
    active += 1;
    state.peak = Math.max(state.peak, active);
    state.asked.push(userGithubId);
    await new Promise((resolve) => setImmediate(resolve));
    active -= 1;
    return verdicts.get(userGithubId) ?? 'not_member';
  });
  return { service: { isOrgMember }, isOrgMember, state };
}

test('the facts name the organisation and hold the ids found to be members; permission_missing and not_member are no membership', async () => {
  const { service } = scripted(
    new Map<number, OrgMembershipVerdict>([
      [1, 'member'],
      [2, 'permission_missing'],
      [3, 'not_member'],
      [4, 'member'],
    ]),
  );
  const facts = await readOrgMembers(service, INSTALLATION, ORG, [person(1), person(2), person(3), person(4)]);
  expect(facts).toEqual(new Map([[ORG, new Set([1, 4])]]));
});

test('the lookups are made as the installation, by id, with the login the job saw', async () => {
  const { service, isOrgMember } = scripted();
  await readOrgMembers(service, INSTALLATION, ORG, [person(1)]);
  expect(isOrgMember).toHaveBeenCalledWith({
    githubInstallationId: INSTALLATION,
    userGithubId: 1,
    login: 'user-1',
  });
});

test('no more than eight lookups run at once, and every candidate is asked', async () => {
  const { service, state } = scripted();
  const people = Array.from({ length: 19 }, (_, index) => person(index + 1));
  await readOrgMembers(service, INSTALLATION, ORG, people);
  expect(state.peak).toBe(8);
  expect(state.asked.toSorted((a, b) => a - b)).toEqual(people.map((one) => one.id));
});

test('no candidates, no members: the organisation is a fact with nobody in it', async () => {
  const { service, isOrgMember } = scripted();
  expect(await readOrgMembers(service, INSTALLATION, ORG, [])).toEqual(new Map([[ORG, new Set()]]));
  expect(isOrgMember).not.toHaveBeenCalled();
});

test('a lookup that fails fails the facts, with its error', async () => {
  const failure = new Error('rate limited');
  const service: OrgMembership = { isOrgMember: () => Promise.reject(failure) };
  await expect(readOrgMembers(service, INSTALLATION, ORG, [person(1)])).rejects.toBe(failure);
});
