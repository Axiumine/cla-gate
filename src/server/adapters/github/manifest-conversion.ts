// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { GitHubUnavailableError } from '../../services/ports/github-errors.ts';
import {
  type ConversionFailureReason,
  type ManifestConversion,
  ManifestConversionFailure,
} from '../../services/ports/manifest-conversion.ts';
import { apiHeaders } from './api-headers.ts';
import { GITHUB_API_ORIGIN, readJson } from './github-http.ts';

// The last step of GitHub's app-manifest flow over plain `fetch` (E19-S11): `POST /app-manifests/{code}/conversions` trades the
// one-time code for the App's credentials. The call carries no `Authorization` (the code is the credential), refuses a redirect
// so that the answer is never read from anywhere else, and ends after ten seconds. Whatever GitHub answers is parsed with zod
// and nothing of it, the body of a failure above all, reaches an error: the secrets are in that body.

/**
 * The ceiling of the call, so a hung GitHub holds the setup page for seconds and not for ever.
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode).
 */
export const CONVERSION_TIMEOUT_MS = 10_000;

// Stryker disable next-line StringLiteral: the route names the call in the error `readJson` throws, which this adapter replaces with a failure of its own
const ROUTE = 'POST /app-manifests/{code}/conversions';

/**
 * What GitHub answers with, as far as the setup needs it: the App's id and slug, its address and its four credentials. The
 * other fields (owner, permissions, events) are dropped by the parser. A credential that is empty or missing is not an answer.
 */
const conversionSchema = z.object({
  id: z.number().int().positive(),
  slug: z.string().min(1),
  html_url: z.string().min(1),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  webhook_secret: z.string().min(1),
  pem: z.string().min(1),
});

export interface ManifestConversionOptions {
  /** Defaults to the global `fetch`, read at call time so a test that intercepts it later is seen. */
  readonly fetch?: typeof fetch | undefined;
  /** Defaults to {@link CONVERSION_TIMEOUT_MS}. */
  readonly timeoutMs?: number | undefined;
}

/** Why a status other than a success ends the conversion: 404 is a code GitHub does not know, 5xx and 429 are GitHub's trouble. */
function reasonOf(status: number): ConversionFailureReason {
  if (status === 404) {
    return 'code_invalid';
  }
  return status >= 500 || status === 429 ? 'unreachable' : 'unexpected_response';
}

/** Sends the request. @throws ManifestConversionFailure `unreachable` when no answer comes (network failure, timeout, redirect). */
async function send(options: ManifestConversionOptions, code: string): Promise<Response> {
  try {
    return await (options.fetch ?? fetch)(
      `${GITHUB_API_ORIGIN}/app-manifests/${encodeURIComponent(code)}/conversions`,
      {
        method: 'POST',
        headers: apiHeaders(),
        redirect: 'error',
        signal: AbortSignal.timeout(options.timeoutMs ?? CONVERSION_TIMEOUT_MS),
      },
    );
  } catch {
    throw new ManifestConversionFailure('unreachable');
  }
}

/** The JSON body of a successful answer. @throws ManifestConversionFailure `unreachable` when it breaks off, `unexpected_response` when it is not JSON. */
async function bodyOf(response: Response): Promise<unknown> {
  try {
    return await readJson(response, ROUTE);
  } catch (error) {
    throw new ManifestConversionFailure(
      error instanceof GitHubUnavailableError ? 'unreachable' : 'unexpected_response',
    );
  }
}

/** `installUrl` is not in GitHub's answer: it is the address where anyone installs the App, built from its slug alone. */
function installUrlOf(slug: string): string {
  return `https://github.com/apps/${encodeURIComponent(slug)}/installations/new`;
}

/** The conversion over `fetch`. Nothing is kept between calls, and nothing of an answer is logged, stored or put in an error. */
export function createManifestConversion(options: ManifestConversionOptions = {}): ManifestConversion {
  return {
    async convert(code) {
      const response = await send(options, code);
      if (!response.ok) {
        throw new ManifestConversionFailure(reasonOf(response.status));
      }
      const parsed = conversionSchema.safeParse(await bodyOf(response));
      if (!parsed.success) {
        throw new ManifestConversionFailure('unexpected_response');
      }
      const app = parsed.data;
      return {
        appId: app.id,
        slug: app.slug,
        htmlUrl: app.html_url,
        installUrl: installUrlOf(app.slug),
        clientId: app.client_id,
        clientSecret: app.client_secret,
        webhookSecret: app.webhook_secret,
        privateKeyPem: app.pem,
      };
    },
  };
}
