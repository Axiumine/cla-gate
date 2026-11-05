// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FastifyError } from 'fastify';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { CORPORATE_RULE_STATUS } from '../../../shared/corporate.ts';
import { SIGNER_RULE_STATUS } from '../../../shared/signer-input.ts';
import { CorporateRuleError } from '../../services/corporate-rule-error.ts';
import { SignRuleError } from '../../services/sign-rule-error.ts';
import { AppError, rejectRequest } from './errors.ts';
import { MAX_RETRY_AFTER_SECONDS } from './upstream-failure.ts';

// How the routes of corporate signing answer a rule the request broke (E21-S02): the services throw a `CorporateRuleError` (or, for
// the typed name and the address, the `SignRuleError` of E13-S03) by name, and the scope of the routes turns it into the error body
// of E06-S01 with the status of its table, the rule as the `code` and the details the rule carries (the version in force, for a stale
// one; the field a text rule refused). Neither the typed name, the company name, the title nor the address is ever in the body. GitHub
// failing for an approval of E21-S03 is `upstream_unavailable`, and a rate limit also sets `retry-after` to the wait GitHub asked for, at
// most as long as every other route of the API tells a client to wait.

/** The instance the handler is set on: Fastify with the zod type provider. */
type Routes = Parameters<FastifyPluginCallbackZod>[0];

/** The error of a rule the request broke as the API answers it; any other error is returned as it is. */
function answerFor(error: unknown): unknown {
  if (error instanceof CorporateRuleError) {
    return new AppError(CORPORATE_RULE_STATUS[error.rule], error.rule, error.details);
  }
  return error instanceof SignRuleError ? new AppError(SIGNER_RULE_STATUS[error.rule], error.rule) : error;
}

/** The wait to put in `retry-after` for `error`, in whole seconds, or `undefined` when GitHub asked for none. */
function waitOf(error: unknown): number | undefined {
  return error instanceof CorporateRuleError && error.retryAfterSeconds !== undefined
    ? Math.min(error.retryAfterSeconds, MAX_RETRY_AFTER_SECONDS)
    : undefined;
}

/** Sets the error handler of `app` (and of what is registered on it) that answers a `CorporateRuleError` or a `SignRuleError` with its status and code. */
export function answerCorporateErrors(app: Routes): void {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const wait = waitOf(error);
    if (wait !== undefined) {
      // The reply is a thenable that settles when the response is sent: the result of `header` is dropped, never awaited.
      void reply.header('retry-after', String(wait));
    }
    return rejectRequest(answerFor(error), request, reply);
  });
}
