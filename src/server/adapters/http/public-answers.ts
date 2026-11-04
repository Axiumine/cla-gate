// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';
import type { z } from 'zod';
import { publicRepositoryParamsSchema, publicSignerParamsSchema } from '../../../shared/public-verification.ts';
import { isPublicRepository, type PublicVerificationDeps, verifySigner } from '../../services/public-verification.ts';
import type { Database } from '../db/schema.ts';
import { AppError } from './errors.ts';
import type { PublicRateLimit } from './public-rate-limit.ts';

// What the public routes have in common (E22-S02, E22-S03): the reading of the path, the one decision each answer rests on, and the
// options every one of them is registered with. The routes that answer with JSON and those that answer with an image ask the same
// questions through these functions, so they cannot read a path or a state differently.

/**
 * The path parameters of a public call, read with the shared schema.
 * @throws AppError 400 `invalid_input` when the repository id is not a positive safe integer in plain digits or the login does not have the shape of a GitHub login.
 */
function publicParamsOf<Schema extends z.ZodType>(schema: Schema, request: FastifyRequest): z.output<Schema> {
  const parsed = schema.safeParse(request.params);
  if (!parsed.success) {
    throw new AppError(400, 'invalid_input');
  }
  return parsed.data;
}

/**
 * The answer to the one question of the signer calls: whether the login the path names has a valid signature for the repository it
 * names.
 * @throws AppError 404 `not_found` for a repository that may not be asked about (unknown, not enforcing, not opted in, or whose
 * installation is not served), 400 `invalid_input` for a path that is not what GitHub allows, and the failure of the lookup when
 * GitHub cannot say who the login is.
 */
export async function signedByPath(deps: PublicVerificationDeps, request: FastifyRequest): Promise<boolean> {
  const verdict = await verifySigner(deps, publicParamsOf(publicSignerParamsSchema, request));
  if (verdict.kind === 'not_found') {
    throw new AppError(404, 'not_found');
  }
  return verdict.signed;
}

/**
 * Makes sure the repository the path names may be spoken of in public (the project badge).
 * @throws AppError 404 `not_found` for a repository that may not be, the same answer as for the signer calls, and 400 `invalid_input` for an id that is not one.
 */
export async function requirePublicRepository(db: Kysely<Database>, request: FastifyRequest): Promise<void> {
  const { githubRepoId } = publicParamsOf(publicRepositoryParamsSchema, request);
  if (!(await isPublicRepository(db, githubRepoId))) {
    throw new AppError(404, 'not_found');
  }
}

/**
 * The options every public route is registered with: the budgets of {@link publicRateLimit} first, no `HEAD` twin (the routes are
 * `GET` only: a twin would answer, and be counted, on its own), and the declaration of a route that needs no session.
 */
export function publicRouteOptions(limit: PublicRateLimit) {
  return { onRequest: limit, exposeHeadRoute: false, config: { access: 'public', session: 'none' } } as const;
}
