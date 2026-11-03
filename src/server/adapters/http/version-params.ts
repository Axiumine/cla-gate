// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { idText, paramsOf } from './tenant-resolvers.ts';

// The path parameter that names a version (E12-S05). It is read after the guard of the tenant has let the call in, so a
// malformed one is a 400 only for a person who may know the document; the version is then looked up under the document and the
// installation of the path, never by its id alone.

const versionParams = z.object({ versionId: idText });

/** The `:versionId` of a route that has passed its guard. @throws AppError 400 when it is not a positive integer in plain digits. */
export function versionIdOf(request: FastifyRequest): number {
  return paramsOf(versionParams, request).versionId;
}
