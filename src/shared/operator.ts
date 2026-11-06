// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { defineRoute } from './contract.ts';
import { githubIdSchema } from './github-id.ts';

/** Where the operator lists the installations of the instance (E11-S08). The route, its tests and the operator screen (E18) share it. */
export const OPERATOR_INSTALLATIONS_PATH = '/api/operator/installations';

/** What a tenant is for the purpose of access, in the order the states are checked (E11-S07). */
const tenantStateSchema = z.enum(['rejected', 'deleted', 'suspended', 'active']);

/** A time as the API tells it: ISO 8601 in UTC, or null while it has not happened. */
const instantSchema = z.iso.datetime({ offset: false }).nullable();

const count = z.int().nonnegative();

/**
 * One installation as the operator sees it (E11-S08): what the instance decided about the account, the state that decides
 * what its admins may do, and how much of it is in use. Ids, display snapshots of the account (the login may be renamed on
 * GitHub, the id is the identity), times and counts only: no sender, member or signer, no signature and no personal data.
 */
const operatorInstallationSchema = z.object({
  /** GitHub's id of the installation (the tenant key on GitHub's side); never an `installations.id`, which is in no response. */
  githubInstallationId: githubIdSchema,
  accountId: githubIdSchema,
  accountLogin: z.string(),
  accountType: z.enum(['Organization', 'User', 'Other']),
  admissionStatus: z.enum(['admitted', 'rejected']),
  /** Why a rejected installation is rejected; null for an admitted one and for one nobody has decided on yet. */
  admissionReason: z.enum(['account_not_allowed', 'policy_changed']).nullable(),
  admissionDecidedAt: instantSchema,
  suspendedAt: instantSchema,
  deletedAt: instantSchema,
  tenantState: tenantStateSchema,
  repositories: z.object({
    /** Stored and not removed. */
    active: count,
    /** Active and enforced. */
    enabled: count,
    /** Removed (access lost, uninstalled or transferred); the rows stay. */
    removed: count,
  }),
});

/** `GET /api/operator/installations` (E11-S08): every installation the instance knows, oldest GitHub installation first. */
export const operatorInstallationsResponseSchema = z.object({ installations: z.array(operatorInstallationSchema) });

/**
 * `GET /api/operator/installations` (E11-S08), as the operator screen of E18-S13 calls it: the method, the path and the schema of
 * the answer are those the server registers. Anyone who is not the operator gets the `404 not_found` of a route that does not exist
 * (the client reads it with the standard error body), a visitor with no session a `401`.
 */
export const operatorInstallationsRoute = defineRoute({
  method: 'GET',
  path: OPERATOR_INSTALLATIONS_PATH,
  responses: { 200: operatorInstallationsResponseSchema },
});
