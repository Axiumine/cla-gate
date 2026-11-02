// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { evaluatePullRequest } from './evaluate.ts';
import {
  account,
  allowlistEntry,
  commitFacts,
  evaluationInput,
  membership,
  shuffled,
  signatureFact,
} from './test-support.ts';
import type { AllowlistEntry, SignatureFact } from './types.ts';

// E08-S04: the cost of coverage. The signature facts and the allowlist are read once per evaluation, not once per actor,
// so a big repository (tens of thousands of signers) and a pull request with thousands of actors do not multiply.

/** A read-only view of `items` that counts how many elements were read through it. */
function counted<T>(items: readonly T[]): { readonly view: readonly T[]; readonly reads: () => number } {
  let reads = 0;
  const view = new Proxy(items, {
    get(target, property, receiver: unknown): unknown {
      if (typeof property === 'string' && /^\d+$/.test(property)) {
        reads += 1;
      }
      return Reflect.get(target, property, receiver);
    },
  });
  return { view, reads: () => reads };
}

const FIRST = 100_000_000;
const AUTHORS = 1500;
const commits = Array.from({ length: AUTHORS }, (_unused, index) =>
  commitFacts(index + 10, { author: account(FIRST + index), committer: account(FIRST + index) }),
);

test('every signature fact is read once for 1,500 actors, not once per actor', () => {
  const signatures: SignatureFact[] = Array.from({ length: 20_000 }, (_unused, index) =>
    signatureFact(index + 1, FIRST + index),
  );
  const { view, reads } = counted(signatures);
  const evaluation = evaluatePullRequest(evaluationInput({ commits, signatures: view }));
  expect(reads()).toBeLessThanOrEqual(signatures.length);
  expect(evaluation.actors.filter((actor) => actor.covered)).toHaveLength(AUTHORS);
});

test('every allowlist entry is read once for 1,500 actors, not once per actor', () => {
  const entries: AllowlistEntry[] = Array.from({ length: 3000 }, (_unused, index) =>
    allowlistEntry(index + 1, 'user', FIRST + index),
  );
  const { view, reads } = counted(entries);
  const evaluation = evaluatePullRequest(evaluationInput({ commits, allowlist: view }));
  expect(reads()).toBeLessThanOrEqual(entries.length);
  expect(evaluation.actors.filter((actor) => actor.covered)).toHaveLength(AUTHORS);
});

test('the indexed lookups give the same answer as before whatever the order of the facts', () => {
  const signatures = Array.from({ length: 500 }, (_unused, index) => signatureFact(index + 1, FIRST + (index % 250)));
  const allowlist = [
    allowlistEntry(1, 'org_members', 777),
    allowlistEntry(2, 'user', FIRST + 300),
    allowlistEntry(3, 'user', FIRST + 300, 'installation'),
  ];
  const input = evaluationInput({ commits, signatures, allowlist, orgMembers: membership([777, [FIRST + 400]]) });
  const expected = evaluatePullRequest(input);
  for (const seed of [1, 2, 3]) {
    const mixed = { ...input, signatures: shuffled(signatures, seed), allowlist: shuffled(allowlist, seed) };
    expect(evaluatePullRequest(mixed)).toEqual(expected);
  }
  const basisOf = (id: number) => expected.actors.find((actor) => actor.account.id === id)?.basis;
  expect(basisOf(FIRST + 10)).toEqual({ kind: 'signature', signatureId: 11, versionId: 1011, major: 1 });
  expect(basisOf(FIRST + 300)).toEqual({ kind: 'allowlist', entryId: 2, entryKind: 'user', scope: 'repository' });
  expect(basisOf(FIRST + 400)).toEqual({
    kind: 'allowlist',
    entryId: 1,
    entryKind: 'org_members',
    scope: 'repository',
  });
  expect(basisOf(FIRST + 900)).toBeNull();
});
