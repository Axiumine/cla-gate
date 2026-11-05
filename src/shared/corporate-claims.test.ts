// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import {
  CORPORATE_AVAILABILITY_PATH,
  CORPORATE_CLAIM_PAGE_PATH,
  CORPORATE_CLAIMS_PATH,
  corporateAvailabilityRoute,
  corporateAvailabilitySchema,
  corporateClaimAlreadyCoveredSchema,
  corporateClaimCoveredSchema,
  corporateClaimRequestSchema,
  corporateClaimRoute,
  NO_MATCHING_APPROVAL_HINT,
} from './corporate-claims.ts';

// The contract of the claim of an employee (E21-S04): the paths, the hint of a refusal, and the shape of every request and answer.

test('the paths are the ones the story fixes, and the page of the claim sits beside the page where a company signs', () => {
  expect([CORPORATE_AVAILABILITY_PATH, CORPORATE_CLAIMS_PATH, CORPORATE_CLAIM_PAGE_PATH]).toEqual([
    '/api/corporate/repositories/:githubRepoId/availability',
    '/api/corporate/repositories/:githubRepoId/claims',
    '/corporate/claim/:githubRepoId',
  ]);
});

test('the descriptors name their method and path, and take the repository by the numeric id of GitHub', () => {
  expect([corporateAvailabilityRoute.name, corporateClaimRoute.name]).toEqual([
    'GET /api/corporate/repositories/:githubRepoId/availability',
    'POST /api/corporate/repositories/:githubRepoId/claims',
  ]);
  for (const route of [corporateAvailabilityRoute, corporateClaimRoute]) {
    expect(route.params.safeParse({ githubRepoId: 4242 }).success).toBe(true);
    expect(route.params.safeParse({ githubRepoId: 0 }).success).toBe(false);
    expect(route.params.safeParse({ githubRepoId: 1.5 }).success).toBe(false);
    expect(route.params.safeParse({ githubRepoId: '4242' }).success).toBe(false);
  }
});

test('the availability is one flag and nothing else', () => {
  expect(corporateAvailabilitySchema.safeParse({ corporateAvailable: true }).success).toBe(true);
  expect(corporateAvailabilitySchema.safeParse({ corporateAvailable: false }).success).toBe(true);
  for (const bad of [{}, { corporateAvailable: 'yes' }, { corporateAvailable: true, companyName: 'Acme' }]) {
    expect(corporateAvailabilitySchema.safeParse(bad).success).toBe(false);
  }
});

test('a claim is the confirmation true and nothing else', () => {
  expect(corporateClaimRequestSchema.safeParse({ confirm: true }).success).toBe(true);
  for (const bad of [{}, { confirm: false }, { confirm: 'true' }, { confirm: true, extra: 1 }, null]) {
    expect(corporateClaimRequestSchema.safeParse(bad).success).toBe(false);
  }
});

test('the two successes are a status word each and name no company, agreement or approval', () => {
  expect(corporateClaimCoveredSchema.safeParse({ status: 'covered' }).success).toBe(true);
  expect(corporateClaimAlreadyCoveredSchema.safeParse({ status: 'already_covered' }).success).toBe(true);
  expect(corporateClaimCoveredSchema.safeParse({ status: 'already_covered' }).success).toBe(false);
  expect(corporateClaimAlreadyCoveredSchema.safeParse({ status: 'covered' }).success).toBe(false);
  expect(corporateClaimCoveredSchema.safeParse({ status: 'covered', agreementId: 7 }).success).toBe(false);
  expect(corporateClaimRoute.responses[201].safeParse({ status: 'covered' }).success).toBe(true);
  expect(corporateClaimRoute.responses[200].safeParse({ status: 'already_covered' }).success).toBe(true);
});

test('the hint of a refusal is fixed text that points at the CLA manager and names no company', () => {
  expect(NO_MATCHING_APPROVAL_HINT).toBe(
    "No agreement covers you yet. Ask your employer's CLA manager to approve your GitHub account, your e-mail domain or your GitHub organisation, then try again.",
  );
});
