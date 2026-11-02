// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';

// The surrogate key of `installations` (`installations.id`): the tenant key every tenant table points at. It is a
// different number from the GitHub installation id a webhook or an API answer carries, and the two must never be taken
// for each other: a repository query given the GitHub id would read or write another tenant's rows whenever the two
// numbering spaces overlap. The brand makes that a compile error, the way `GithubId` keeps our keys from being used as
// GitHub ids (E04-S09). The only values are the ones read from the database.

/**
 * Brands a number as an `installations.id`. The database types produce branded values, so the only production code that
 * calls it is the one that reads an id from a path (the resolvers of E11-S05); the tests make ids for rows that do not exist.
 */
export const installationRowIdSchema = z.int().positive().brand<'InstallationRowId'>();

export type InstallationRowId = z.infer<typeof installationRowIdSchema>;
