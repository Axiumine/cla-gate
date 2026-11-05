// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { z } from 'zod';
import { parseGithubId } from '../../shared/github-id.ts';
import {
  affectedEvaluationKey,
  affectedSweepKey,
  MAX_AFFECTED_PULL_REQUESTS,
  OVERRIDDEN_COMMIT_PATH,
  overriddenCommitVars,
  signatureBasisNeedles,
} from './affected-prs.ts';

// The pure rules of the re-evaluation an action of a maintainer asks for (E15-S03): the cap, the keys of the sends and the two
// documents a stored result must contain to rely on a signature.

const REVOKED = { reason: 'signature_revoked', change: '31' } as const;

test('up to 100 pull requests are evaluated one by one, and no more', () => {
  expect(MAX_AFFECTED_PULL_REQUESTS).toBe(100);
});

test('the key of an evaluation names the reason, the action, the repository and the pull request, so no two sends of one action share it', () => {
  const keys = [
    affectedEvaluationKey(REVOKED, parseGithubId(9000), 45),
    affectedEvaluationKey(REVOKED, parseGithubId(9000), 46),
    affectedEvaluationKey(REVOKED, parseGithubId(9001), 45),
    affectedEvaluationKey({ ...REVOKED, change: '32' }, parseGithubId(9000), 45),
    affectedEvaluationKey({ ...REVOKED, reason: 'override_changed' }, parseGithubId(9000), 45),
  ];
  expect(keys).toEqual([
    'signature_revoked:31:9000:45',
    'signature_revoked:31:9000:46',
    'signature_revoked:31:9001:45',
    'signature_revoked:32:9000:45',
    'override_changed:31:9000:45',
  ]);
  expect(new Set(keys).size).toBe(keys.length);
});

test('the key of a sweep has the form of the allowlist sweep, and names the action and the repository', () => {
  expect(affectedSweepKey(REVOKED, parseGithubId(9000))).toBe('sweep-repository:signature_revoked:31:9000');
  expect(affectedSweepKey({ ...REVOKED, change: '32' }, parseGithubId(9001))).toBe(
    'sweep-repository:signature_revoked:32:9001',
  );
});

test('the two needles are the actor with the signer id covered by a signature, and the actor whose basis names the signature', () => {
  const [bySigner, bySignature] = signatureBasisNeedles(31, parseGithubId(4711));
  expect(JSON.parse(bySigner)).toEqual({
    actors: [{ githubId: 4711, covered: true, basis: { kind: 'signature' } }],
  });
  expect(JSON.parse(bySignature)).toEqual({
    actors: [{ covered: true, basis: { kind: 'signature', signatureId: 31 } }],
  });
});

test('the path that finds the results resting on an override reads the entries of unlinked by the commit in the variable sha and requires an override id', () => {
  expect(OVERRIDDEN_COMMIT_PATH).toBe('$.unlinked[*] ? (@.sha == $sha && @.overrideId != null)');
  expect(JSON.parse(overriddenCommitVars('ab'.repeat(20)))).toEqual({ sha: 'ab'.repeat(20) });
});

test('the variables hold the commit as a JSON string and nothing else, whatever characters it has, so the path cannot be altered through it', () => {
  const hostile = `a"}; drop table pr_evaluations;--`;
  expect(z.record(z.string(), z.string()).parse(JSON.parse(overriddenCommitVars(hostile)))).toEqual({ sha: hostile });
});
