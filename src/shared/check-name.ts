// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

/**
 * The name of the Check Run the platform posts on every pull request (E06-S04). It is constant: a repository's required
 * check rule names it, so renaming it would leave every protected branch waiting for a check that never arrives. The
 * webhook router recognises a re-run request of our own check by it, and the reporter (E09) posts under it.
 */
export const CHECK_NAME = 'license/cla';
