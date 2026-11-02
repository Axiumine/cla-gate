// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { Octokit } from 'octokit';
import type { Logger } from 'pino';

// How the Octokit adapter talks to api.github.com (E05-S04): one place for the timeout, the redirect refusal and the
// retry rule, wired into the `fetch` Octokit is given, plus the plugin settings that keep Octokit's own retry and
// throttling from deciding anything the story's rules decide.

/** Waits before the first and the second repeat of a GET: 1 s, then 2 s. */
const BACKOFF_MS = [1000, 2000] as const;

/** Up to this much is added to each wait, so the instances of a fleet that failed together do not return together. */
const JITTER_MS = 250;

/** The statuses that say "try again" for an idempotent request. A 500 is a verdict about this request, not an outage. */
const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);

export interface TransportOptions {
  /** The `fetch` that sends the request; tests intercept it with MSW. */
  readonly fetch: typeof fetch;
  /** How long one attempt waits for GitHub's answer. */
  readonly timeoutMs: number;
  readonly logger: Logger;
  /** Waits between attempts; defaults to a timer. Tests record the waits instead of sitting through them. */
  readonly sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  /** In [0, 1): the jitter's share of {@link JITTER_MS}. Defaults to `Math.random`. */
  readonly random?: (() => number) | undefined;
}

/** What one attempt produced: an answer, or the reason there was none. */
type Attempt = { readonly response: Response } | { readonly failure: unknown };

const pause = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

async function attempt(send: typeof fetch, input: Parameters<typeof fetch>[0], init: RequestInit): Promise<Attempt> {
  try {
    return { response: await send(input, init) };
  } catch (failure) {
    return { failure };
  }
}

/** Why an attempt is worth repeating (`network`, or the status), or undefined when it is not. */
function transientReason(outcome: Attempt): string | undefined {
  if ('failure' in outcome) {
    return 'network';
  }
  return TRANSIENT_STATUSES.has(outcome.response.status) ? String(outcome.response.status) : undefined;
}

/** The method of a request made through `fetch(input, init)`. Octokit always names it in `init`. */
function methodOf(input: Parameters<typeof fetch>[0], init: RequestInit | undefined): string {
  return (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
}

/** What to do after an attempt of an idempotent request: wait `wait` ms because of `reason`, or undefined to stop. */
function planRepeat(outcome: Attempt, repeats: number): { reason: string; wait: number } | undefined {
  const reason = transientReason(outcome);
  const wait = BACKOFF_MS.at(repeats);
  return reason === undefined || wait === undefined ? undefined : { reason, wait };
}

/** The last attempt's result: its answer, or its failure thrown. */
function settle(outcome: Attempt): Response {
  if ('failure' in outcome) {
    throw outcome.failure;
  }
  return outcome.response;
}

/** Drops the failed answer, says so, and waits out the backoff plus jitter. */
async function backOff(
  outcome: Attempt,
  repeat: { reason: string; wait: number },
  { logger, sleep = pause, random = Math.random }: TransportOptions,
): Promise<void> {
  if ('response' in outcome) {
    await outcome.response.body?.cancel();
  }
  logger.warn({ reason: repeat.reason, waitMs: repeat.wait }, 'github.request_repeated');
  await sleep(repeat.wait + Math.round(random() * JITTER_MS));
}

/**
 * `fetch` as the adapter needs it: every attempt has a timeout and refuses a redirect (the token goes to api.github.com
 * and nowhere else), and an idempotent GET that ends in a network error, a timeout, a 502, a 503 or a 504 is repeated
 * twice, after 1 s and after 2 s, each plus up to 250 ms. Any other request is sent once, whatever happens: write
 * idempotency is not the adapter's to decide (E09).
 * @internal Exported for the unit tests (Knip ignores `@internal` exports in production mode); {@link createOctokit} uses it.
 */
export function guardedFetch(options: TransportOptions): typeof fetch {
  return async (input, init) => {
    const idempotent = methodOf(input, init) === 'GET';
    for (let repeats = 0; ; repeats += 1) {
      const signal = AbortSignal.timeout(options.timeoutMs);
      const outcome = await attempt(options.fetch, input, { ...init, redirect: 'error', signal });
      const repeat = idempotent ? planRepeat(outcome, repeats) : undefined;
      if (repeat === undefined) {
        return settle(outcome);
      }
      await backOff(outcome, repeat, options);
    }
  };
}

const silent = (): void => undefined;

/**
 * The Octokit instance of the adapter. It is the `octokit` package with its plugins: the retry plugin stays registered
 * but is set to no retries, because its schedule (1 s, 4 s, 9 s, writes included) is not the rule of
 * {@link guardedFetch}, and the throttling plugin stays registered with handlers that never wait for a rate limit,
 * because the story that owns rate limits (E05-S05) decides what a rate limit costs. The plugin's own limits on
 * concurrent requests and on writes (10 reads at once, one write per second) stay as they are. Octokit's log is
 * silent: a URL can carry an organisation name.
 */
export function createOctokit(options: TransportOptions): Octokit {
  return new Octokit({
    request: { fetch: guardedFetch(options) },
    retry: { retries: 0 },
    throttle: { onRateLimit: () => false, onSecondaryRateLimit: () => false },
    log: { debug: silent, info: silent, warn: silent, error: silent },
  });
}
