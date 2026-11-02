// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// E08-S02: GitHub's own identities that the engine knows by number. Identity is always the numeric id, never a login.

/**
 * The numeric id of GitHub's `web-flow` account, the committer of every commit made in the web UI (merge, revert, edit).
 * Verified on 2026-11-02 with `GET https://api.github.com/users/web-flow`: login `web-flow`, type `User`, id 19864447.
 * A committer with this id is exempt from the CLA (the author of the commit is the person who must be covered). A
 * committer whose login or app slug merely says `web-flow` is not: the engine compares ids only.
 */
export const GITHUB_WEB_FLOW_ID = 19_864_447;
