// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyContextConfig } from 'fastify';

/**
 * What every setup route declares (E19-S06): `public`, because there is no login while there is no App (E11-S01), and no
 * session lookup (`session: 'none'`), so none of them costs a query.
 */
export const PUBLIC_NO_SESSION = { access: 'public', session: 'none' } satisfies FastifyContextConfig;

/** What the two `POST` routes add: `auditExempt: 'setup'` (E04-S09), because no actor exists before the App does, so there is nothing to record. */
export const SETUP_POST = { ...PUBLIC_NO_SESSION, auditExempt: 'setup' } satisfies FastifyContextConfig;
