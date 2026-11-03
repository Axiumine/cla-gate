// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Kysely } from 'kysely';
import {
  DRAFT_PATH,
  draftResponseSchema,
  saveDraftRequestSchema,
  savedDraftResponseSchema,
} from '../../../shared/cla.ts';
import { discardDraft, readDraft, saveDraft } from '../../services/cla-drafts.ts';
import type { Database } from '../db/schema.ts';
import { requireAuth } from './auth-request.ts';
import { presentDraft, presentSavedDraft } from './document-presenters.ts';
import { CLA_BODY_LIMIT } from './limits.ts';
import { setNoStore } from './no-store.ts';
import { userRateLimit } from './rate-limit.ts';
import { parseInput } from './request-body.ts';
import { requireTenant, tenantAccess } from './tenant-access.ts';
import { byDocumentParam, documentIdOf } from './tenant-resolvers.ts';

// The routes of the draft of one document (E12-S03): read, save and discard. The requirement follows the scope of the
// document (`byDocumentParam`), so the draft is shared by every admin of that scope. The draft is not returned by any other
// route: the document carries only the flag `hasDraft`. Every answer is told not to be cached.

/** The instance the routes are registered on: Fastify with the zod type provider. */
type Routes = Parameters<FastifyPluginCallbackZod>[0];

/** Saves a person may make in a minute (E12-S03): the editor saves on an explicit action only, so this is far above use. */
const DRAFT_SAVES_PER_MINUTE = 30;

/** `GET .../documents/:documentId/draft`: the draft with its text, or `null` when none is saved. */
export function readDraftRoute(app: Routes, db: Kysely<Database>): void {
  app.get(
    DRAFT_PATH,
    {
      schema: { response: { 200: draftResponseSchema } },
      config: { access: tenantAccess({ mode: 'read', resolve: byDocumentParam(db) }) },
    },
    async (request, reply) => {
      const draft = await readDraft(db, requireTenant(request), documentIdOf(request));
      setNoStore(reply);
      return { draft: draft === null ? null : presentDraft(draft) };
    },
  );
}

/**
 * `PUT .../documents/:documentId/draft`: audited as `cla_draft.saved`, in the transaction of the save. The budget of 30
 * saves a minute is the person's, keyed on the numeric GitHub id, and is spent after the guard has let the call in: a
 * denied call costs the person nothing (`userRateLimit`, E16-S03).
 */
export function saveDraftRoute(app: Routes, db: Kysely<Database>): void {
  app.put(
    DRAFT_PATH,
    {
      bodyLimit: CLA_BODY_LIMIT,
      schema: { response: { 200: savedDraftResponseSchema } },
      config: {
        access: tenantAccess({ mode: 'write', resolve: byDocumentParam(db) }),
        audit: 'cla_draft.saved',
        rateLimit: userRateLimit(DRAFT_SAVES_PER_MINUTE),
      },
    },
    async (request, reply) => {
      const body = parseInput(saveDraftRequestSchema, request.body);
      const saved = await saveDraft(db, requireTenant(request), requireAuth(request).user, {
        documentId: documentIdOf(request),
        contentMd: body.contentMd,
        expectedRevision: body.expectedRevision,
      });
      setNoStore(reply);
      return { draft: presentSavedDraft(saved) };
    },
  );
}

/** `DELETE .../documents/:documentId/draft`: `204`, also when no draft exists; audited as `cla_draft.discarded` when one was. */
export function discardDraftRoute(app: Routes, db: Kysely<Database>): void {
  app.delete(
    DRAFT_PATH,
    {
      bodyLimit: CLA_BODY_LIMIT,
      config: {
        access: tenantAccess({ mode: 'write', resolve: byDocumentParam(db) }),
        audit: 'cla_draft.discarded',
      },
    },
    async (request, reply) => {
      await discardDraft(db, requireTenant(request), requireAuth(request).user.githubId, documentIdOf(request));
      setNoStore(reply);
      reply.statusCode = 204;
    },
  );
}
