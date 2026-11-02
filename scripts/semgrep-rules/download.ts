// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { parse } from 'yaml';
import { z } from 'zod';
import { messageOf } from '../ci/lib/errors.ts';
import { rulesetUrl } from './rulesets.ts';

/** The part of a `Response` that is used; the global `fetch` fits, and tests pass a fake. */
interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly text: () => Promise<string>;
}

/** The part of `fetch` that is used. A redirect is an error: the rules must come from the registry host itself. */
export type FetchLike = (
  url: string,
  init: {
    readonly signal: AbortSignal;
    readonly redirect: 'error';
    readonly headers: Readonly<Record<string, string>>;
  },
) => Promise<HttpResponse>;

/** One rule set: its text, or why it could not be had (the reason does not repeat the rule set name). */
export type Download =
  | { readonly ok: true; readonly name: string; readonly body: string }
  | { readonly ok: false; readonly name: string; readonly reason: string };

/**
 * Asks for YAML and for no compression: the registry answers a client that accepts gzip with the same rules as JSON,
 * and `rules/<name>.yaml` should hold the YAML text it is named after.
 */
const HEADERS = { accept: 'text/yaml', 'accept-encoding': 'identity' };

/** The whole request, body included, must end within this time. */
const TIMEOUT_MS = 60_000;

/** A Semgrep rule file: a mapping with a non-empty `rules` list, every rule with an id. */
const rulesFileSchema = z.object({ rules: z.array(z.object({ id: z.string().min(1) })).min(1) });

/** `undefined` when `body` is a Semgrep rule file, else what is wrong with it (one line, nothing of the body). */
function problemWithRules(body: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = parse(body);
  } catch (error) {
    return `not valid YAML: ${messageOf(error).split('\n', 1).join('')}`;
  }
  return rulesFileSchema.safeParse(parsed).success ? undefined : 'not a Semgrep rule file (no rules list with ids)';
}

function failed(name: string, reason: string): Download {
  return { ok: false, name, reason };
}

/**
 * Downloads one rule set and checks that it is a rule file, so a captive portal's HTML page or an empty answer is never
 * saved as a rule set. Never throws: a network error, a timeout, an HTTP error status and an unusable body all come
 * back as `ok: false` with a reason that names the URL.
 */
export async function downloadRuleset(name: string, fetchImpl: FetchLike, timeoutMs = TIMEOUT_MS): Promise<Download> {
  const url = rulesetUrl(name);
  let body: string;
  try {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'error',
      headers: HEADERS,
    });
    if (!response.ok) {
      return failed(name, `HTTP ${response.status} from ${url}`);
    }
    body = await response.text();
  } catch (error) {
    return failed(name, `network error: ${messageOf(error)} (${url})`);
  }
  const problem = problemWithRules(body);
  return problem === undefined ? { ok: true, name, body } : failed(name, `${problem} (${url})`);
}
