// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyInstance } from 'fastify';
import type { RoleCache } from '../../services/role-cache.ts';

// Where the application keeps its role cache (E11-S04): one per process, shared by everything that has to read it or
// forget what it holds. The guards of E11-S05 read it; logout (E10-S06) and the `revoke-user-sessions` job (E10-S07)
// invalidate it, and the job's handler is bound by whoever wires the queue from `app.roleCache`.

declare module 'fastify' {
  interface FastifyInstance {
    /** The roles GitHub reported, kept for a minute (E11-S04). The only instance of the process. */
    roleCache: RoleCache;
  }
}

/** Puts `cache` on the application as `app.roleCache`. Called once by `buildApp`, before any route is registered. */
export function registerRoleCache(app: FastifyInstance, cache: RoleCache): void {
  app.decorate('roleCache', cache);
}
