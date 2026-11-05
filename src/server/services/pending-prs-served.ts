// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type SqlBool, sql } from 'kysely';

// What makes a repository one whose pull requests are listed (E15-S07), as a condition on the aliases `r` (repositories) and `i`
// (installations) of a statement.

/** The repository `r` is on and not removed, and its installation `i` is admitted, not suspended and not uninstalled (the states of `tenantState`). */
export const SERVED = sql<SqlBool>`(r.enabled and r.removed_at is null and i.admission_status = 'admitted' and i.suspended_at is null and i.deleted_at is null)`;
