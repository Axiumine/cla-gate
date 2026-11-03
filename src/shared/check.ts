// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/**
 * The name of the Check Run the platform posts on every pull request (E06-S04, E09-S02). It is exported once and never
 * retyped: a repository's required check rule names it, so renaming it would leave every protected branch waiting for a
 * check that never arrives. The webhook router recognises a re-run request of our own check by it, and the reporter (E09)
 * posts under it. A test (`src/server/check-name-literal.test.ts`) fails when another source file spells the name as a string literal.
 */
export const CHECK_RUN_NAME = 'license/cla';
