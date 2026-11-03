// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyError } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { CLA_RULE_STATUS } from '../../../shared/cla.ts';
import { ClaRuleError } from '../../services/cla-rule-error.ts';
import { AppError, rejectRequest } from './errors.ts';

// How the routes of the CLA documents answer a rule the request broke (E12-S01, E12-S02): the service throws a
// `ClaRuleError` by name, and the scope of the routes turns it into the error body of E06-S01 with the status of
// `CLA_RULE_STATUS`, the rule as the `code` and the details the rule carries (the size of a text that is too large).

/** The instance the handler is set on: Fastify with the zod type provider. */
type Routes = Parameters<FastifyPluginCallbackZod>[0];

/** The error of a rule the request broke as the API answers it; any other error is returned as it is. */
function answerFor(error: unknown): unknown {
  return error instanceof ClaRuleError ? new AppError(CLA_RULE_STATUS[error.rule], error.rule, error.details) : error;
}

/** Sets the error handler of `app` (and of what is registered on it) that answers a `ClaRuleError` with its status and code. */
export function answerRuleErrors(app: Routes): void {
  app.setErrorHandler((error: FastifyError, request, reply) => rejectRequest(answerFor(error), request, reply));
}
