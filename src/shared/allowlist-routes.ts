// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import {
  ALLOWLIST_ENTRY_PATH,
  allowlistEntryRequestSchema,
  allowlistEntryResponseSchema,
  allowlistPageSchema,
  allowlistQuerySchema,
  INSTALLATION_ALLOWLIST_PATH,
  REPOSITORY_ALLOWLIST_PATH,
  repositoryAllowlistPageSchema,
} from './allowlist.ts';
import { defineRoute } from './contract.ts';
import { installationParamsSchema } from './installations.ts';

// The route descriptors of the allowlist API (E14-S06, E14-S07) that the allowlist screen of E18-S06 calls by: the paths and the
// schemas are those of allowlist.ts, so the screen and the server cannot drift apart.

/** The path parameter of the routes of one repository: `repositories.id`, never GitHub's id. */
const repositoryParamsSchema = z.object({ repositoryId: z.int().positive() });

/** The path parameters of one entry of the tenant: the installation and `allowlist_entries.id`. */
const entryParamsSchema = installationParamsSchema.extend({ entryId: z.int().positive() });

/** `GET .../installations/:installationId/allowlist-entries` (E14-S07): the entries that cover the installation, for an org admin. */
export const installationAllowlistRoute = defineRoute({
  method: 'GET',
  path: INSTALLATION_ALLOWLIST_PATH,
  params: installationParamsSchema,
  query: allowlistQuerySchema,
  responses: { 200: allowlistPageSchema },
});

/** `GET .../repositories/:repositoryId/allowlist-entries` (E14-S07): the entries of the repository (`own`) and those it inherits. */
export const repositoryAllowlistRoute = defineRoute({
  method: 'GET',
  path: REPOSITORY_ALLOWLIST_PATH,
  params: repositoryParamsSchema,
  query: allowlistQuerySchema,
  responses: { 200: repositoryAllowlistPageSchema },
});

/** `POST .../installations/:installationId/allowlist-entries` (E14-S06): exempts an account in every repository of the installation. */
export const addInstallationEntryRoute = defineRoute({
  method: 'POST',
  path: INSTALLATION_ALLOWLIST_PATH,
  params: installationParamsSchema,
  body: allowlistEntryRequestSchema,
  responses: { 201: allowlistEntryResponseSchema },
});

/** `POST .../repositories/:repositoryId/allowlist-entries` (E14-S06): exempts an account in one repository. */
export const addRepositoryEntryRoute = defineRoute({
  method: 'POST',
  path: REPOSITORY_ALLOWLIST_PATH,
  params: repositoryParamsSchema,
  body: allowlistEntryRequestSchema,
  responses: { 201: allowlistEntryResponseSchema },
});

/** `DELETE .../installations/:installationId/allowlist-entries/:entryId` (E14-S07): removes one entry of the tenant, whatever its scope. */
export const removeEntryRoute = defineRoute({
  method: 'DELETE',
  path: ALLOWLIST_ENTRY_PATH,
  params: entryParamsSchema,
  responses: { 204: z.undefined() },
});
