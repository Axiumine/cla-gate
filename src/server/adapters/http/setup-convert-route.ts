// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { convertRequestSchema, SETUP_ERROR_CODES, setupConvertRoute } from '../../../shared/setup.ts';
import {
  type ConversionFailureReason,
  type ManifestConversion,
  ManifestConversionFailure,
  type ManifestCredentials,
} from '../../services/ports/manifest-conversion.ts';
import { AppError } from './errors.ts';
import { SETUP_BODY_LIMIT } from './limits.ts';
import { parseInput } from './request-body.ts';
import { sameSecret } from './setup-digest.ts';
import { requireSetupSession, type SetupGuardDeps } from './setup-guard.ts';
import { SETUP_POST } from './setup-route-config.ts';
import type { SetupSession } from './setup-sessions.ts';

/** The instance the route is registered on: Fastify with the zod type provider. */
type Routes = Parameters<FastifyPluginCallbackZod>[0];

export interface ConvertRouteOptions extends SetupGuardDeps {
  /** How GitHub's one-time code is traded for the credentials of the App. */
  readonly conversion: ManifestConversion;
}

/** What each way the conversion can fail becomes for the page: the status and the code its message catalog has a text for. */
const FAILURES = {
  code_invalid: { status: 400, code: SETUP_ERROR_CODES.codeInvalid },
  unreachable: { status: 502, code: SETUP_ERROR_CODES.githubUnreachable },
  unexpected_response: { status: 502, code: SETUP_ERROR_CODES.githubUnexpected },
} as const satisfies Record<ConversionFailureReason, { readonly status: number; readonly code: string }>;

/**
 * Asks GitHub for the credentials behind `code`. An outage (GitHub could not be reached, `5xx`, `429`) leaves the `state` of the
 * session as it is, so the same page can press the button again; any other answer of GitHub's uses the code up, so the `state`
 * goes with it and a new manifest is the way on. The failure is told by its own code and never by what GitHub said.
 * @throws AppError the mapped failure of a {@link ManifestConversionFailure}; anything else is not ours to name and passes as it is.
 */
async function convertCode(
  conversion: ManifestConversion,
  sessions: SetupGuardDeps['sessions'],
  session: SetupSession,
  code: string,
): Promise<ManifestCredentials> {
  try {
    return await conversion.convert(code);
  } catch (error) {
    if (!(error instanceof ManifestConversionFailure)) {
      throw error;
    }
    if (error.reason !== 'unreachable') {
      sessions.consumeState(session);
    }
    throw new AppError(FAILURES[error.reason].status, FAILURES[error.reason].code);
  }
}

/**
 * `POST /api/setup/convert` (E19-S11): the last step of the manifest flow. It needs the setup session (cookie, CSRF token and
 * `Origin`, see {@link requireSetupSession}, checked before the body is read and before the answer of `409` once the
 * credentials have been handed out) and the `state` of the manifest this very session was given last, compared in constant
 * time; any other `state` is `400 setup_code_invalid`, the same answer as a code GitHub does not know. On success it answers
 * `200` with the credentials, once: the `state` is used up and this process refuses the manifest and the conversion from then
 * on. The credentials exist in this handler's memory from GitHub's answer to the end of the response; they are written to no
 * table, file, log line or error, and the `setup.credentials.issued` event carries nothing but the request id.
 */
export function convertRoute(app: Routes, options: ConvertRouteOptions): void {
  app.post(
    setupConvertRoute.path,
    // Stryker disable next-line ObjectLiteral: the response schema restates what the handler returns, so dropping it changes no response
    { bodyLimit: SETUP_BODY_LIMIT, schema: { response: setupConvertRoute.responses }, config: SETUP_POST },
    async (request, reply): Promise<ManifestCredentials> => {
      const session = requireSetupSession(request, reply, options);
      const { code, state } = parseInput(convertRequestSchema, request.body);
      if (session.state === undefined || !sameSecret(session.state, state)) {
        throw new AppError(FAILURES.code_invalid.status, FAILURES.code_invalid.code);
      }
      const credentials = await convertCode(options.conversion, options.sessions, session, code);
      options.sessions.consumeState(session);
      options.sessions.markCredentialsIssued();
      request.log.info('setup.credentials.issued');
      return credentials;
    },
  );
}
