// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';

// What the address of the allowlist screen holds (E18-S06): `/installations/$installationId/allowlist?repository=<id>`, the scope the
// person is looking at, so a reload, a pasted link and the browser's Back land on the same scope. No `repository` is the whole installation.

/**
 * `?repository=` of the screen: `repositories.id` as a positive whole number, else nothing, so a text, a decimal, a list or a number
 * beyond what a request can carry is dropped and the screen shows the scope of the whole installation. The id is only ever sent in the
 * path of a request the server filters by tenant, so an id of another tenant is the uniform `404` and never data.
 */
export const allowlistSearchSchema = z.object({ repository: z.int().positive().optional().catch(undefined) });
