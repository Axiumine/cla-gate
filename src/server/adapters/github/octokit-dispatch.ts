// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Octokit } from 'octokit';
import type { GithubId } from '../../../shared/github-id.ts';
import type { LaneScope } from './lane.ts';
import { asApp, asInstallation, type Tokens, type WithJwt } from './octokit-auth.ts';
import { type Channel, type RequestHeaders, sendOnce } from './octokit-request.ts';
import type { RateLimiter } from './rate-limiter.ts';

// Who a request of the Octokit adapter is made as, and where it counts against the limits (E05-S04, E05-S05).

export interface DispatchOptions {
  readonly octokit: Octokit;
  readonly withJwt: WithJwt;
  readonly tokens: Tokens;
  readonly limiter: RateLimiter;
  /** The abort signal of the unit of work these requests belong to (E07-S03): a job. Without one nothing can abort them. */
  readonly signal?: AbortSignal | undefined;
}

/** A call of the adapter: it gets the channel to send through and the headers that carry the credential. */
type Call<T> = (channel: Channel, headers: RequestHeaders) => Promise<T>;

export class Dispatch {
  readonly #options: DispatchOptions;

  constructor(options: DispatchOptions) {
    this.#options = options;
  }

  /** `call` signed with the App JWT, in the App's lane of the rate limiter. Nothing is sent once the signal has aborted. */
  async asApp<T>(call: Call<T>): Promise<T> {
    this.#options.signal?.throwIfAborted();
    return asApp(this.#options.withJwt, (headers) => call(this.#channel('app'), headers));
  }

  /**
   * `call` with the installation's token, in the installation's lane of the rate limiter. Nothing is sent, and no token
   * is asked for, once the signal has aborted.
   * @throws whatever the token provider throws (InstallationNotAdmittedError, ...) before any request.
   */
  async asInstallation<T>(githubInstallationId: GithubId, call: Call<T>): Promise<T> {
    this.#options.signal?.throwIfAborted();
    return asInstallation(this.#options.tokens, githubInstallationId, (headers) =>
      call(this.#channel(githubInstallationId), headers),
    );
  }

  /**
   * Where a request counts against the limits: the lane of `scope` in the limiter, which also reads a rate limit of
   * GitHub's from the failed request against its own clock. With a signal (E07-S03) a request made after it aborted is not
   * sent, one in flight is cancelled (the signal is the `request.signal` of Octokit, which `guardedFetch` combines with
   * its timeout), and whatever failed after the abort rejects with the reason of the signal: an aborted job is not told it
   * met an outage.
   */
  #channel(scope: LaneScope): Channel {
    const { octokit, limiter, signal } = this.#options;
    if (signal === undefined) {
      return {
        octokit,
        send: (route, request) => limiter.run(scope, route, () => sendOnce(route, request, limiter.clock)),
      };
    }
    return {
      octokit: { request: octokit.request.defaults({ request: { signal } }) },
      send: async (route, request) => {
        signal.throwIfAborted();
        try {
          return await limiter.run(scope, route, () => sendOnce(route, request, limiter.clock));
        } catch (error) {
          signal.throwIfAborted();
          throw error;
        }
      },
    };
  }
}
