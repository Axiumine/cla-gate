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
}

/** A call of the adapter: it gets the channel to send through and the headers that carry the credential. */
type Call<T> = (channel: Channel, headers: RequestHeaders) => Promise<T>;

export class Dispatch {
  readonly #options: DispatchOptions;

  constructor(options: DispatchOptions) {
    this.#options = options;
  }

  /** `call` signed with the App JWT, in the App's lane of the rate limiter. */
  asApp<T>(call: Call<T>): Promise<T> {
    return asApp(this.#options.withJwt, (headers) => call(this.#channel('app'), headers));
  }

  /**
   * `call` with the installation's token, in the installation's lane of the rate limiter.
   * @throws whatever the token provider throws (InstallationNotAdmittedError, ...) before any request.
   */
  asInstallation<T>(githubInstallationId: GithubId, call: Call<T>): Promise<T> {
    return asInstallation(this.#options.tokens, githubInstallationId, (headers) =>
      call(this.#channel(githubInstallationId), headers),
    );
  }

  /**
   * Where a request counts against the limits: the lane of `scope` in the limiter, which also reads a rate limit of
   * GitHub's from the failed request against its own clock.
   */
  #channel(scope: LaneScope): Channel {
    const { octokit, limiter } = this.#options;
    return {
      octokit,
      send: (route, request) => limiter.run(scope, route, () => sendOnce(route, request, limiter.clock)),
    };
  }
}
