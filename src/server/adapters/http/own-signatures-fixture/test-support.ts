// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';
import { errorResponseSchema } from '../../../../shared/errors.ts';
import {
  OWN_SIGNATURES_PATH,
  type OwnSignaturesPage,
  ownSignaturesPageSchema,
} from '../../../../shared/own-signatures.ts';
import { type Session, type SignWorld, signWorld } from '../sign-context-fixture/test-support.ts';

// The world of the tests of the list of a person's own signatures (E13-S06): the sign context world (two tenants made by
// `seedTenant(db, 1)` and `seedTenant(db, 2)`, admitted, whose repositories `org-<n>/repo` enforce an individual CLA at version 1.0)
// and the request a signed-in person sends. People are the ones `world.login(githubId)` makes.

/** The world, with the way to ask for the list: nobody (`null`) sends no cookie, and `query` is the query string with its `?`. */
export interface OwnSignaturesWorld extends SignWorld {
  readonly list: (session: Session | null, query?: string) => Promise<LightMyRequestResponse>;
}

export async function ownSignaturesWorld(): Promise<OwnSignaturesWorld> {
  const world = await signWorld();
  const list: OwnSignaturesWorld['list'] = (session, query = '') =>
    world.app.inject({
      method: 'GET',
      url: `${OWN_SIGNATURES_PATH}${query}`,
      headers: session === null ? {} : { cookie: session.cookie },
    });
  return { ...world, list };
}

/** The body of a `200` answer, parsed with the shared schema so that a body of another shape fails here. */
export function pageOf(response: { statusCode: number; json: () => unknown }): OwnSignaturesPage {
  expect(response.statusCode).toBe(200);
  return ownSignaturesPageSchema.parse(response.json());
}

/** The status and the `error.code` of an error answer. */
export function failureOf(response: { statusCode: number; json: () => unknown }): [number, string] {
  return [response.statusCode, errorResponseSchema.parse(response.json()).error.code];
}

/** The cursor a client may send: the base64url of the JSON of `value`, which is how the server writes its own. */
export function cursorOf(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}
