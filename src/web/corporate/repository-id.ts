// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
/** GitHub's id of a repository in an address: digits only, no leading zero, small enough to be an exact number. */
export const REPOSITORY_ID_IN_PATH = /^[1-9]\d{0,14}$/u;
