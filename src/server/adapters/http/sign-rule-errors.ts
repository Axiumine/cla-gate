// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyError } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { SIGNER_RULE_STATUS } from '../../../shared/signer-input.ts';
import { SignRuleError } from '../../services/sign-rule-error.ts';
import { AppError, rejectRequest } from './errors.ts';

// How the signing route answers a rule that the typed name or address broke (E13-S03): the service throws a `SignRuleError`
// by name, and the scope of the route turns it into the error body of E06-S01 with the status of `SIGNER_RULE_STATUS` and the
// rule as the `code`. The body holds no detail, so neither the typed name nor the requested address can be in it.

/** The instance the handler is set on: Fastify with the zod type provider. */
type Routes = Parameters<FastifyPluginCallbackZod>[0];

/** Sets the error handler of `app` (and of what is registered on it) that answers a `SignRuleError` with its status and code. */
export function answerSignRuleErrors(app: Routes): void {
  app.setErrorHandler((error: FastifyError, request, reply) =>
    rejectRequest(
      error instanceof SignRuleError ? new AppError(SIGNER_RULE_STATUS[error.rule], error.rule) : error,
      request,
      reply,
    ),
  );
}
