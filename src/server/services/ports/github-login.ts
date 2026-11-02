// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

import type { LoginFailureReason } from '../../../shared/auth.ts';
import type { GithubId } from '../../../shared/github-id.ts';
import type { VerifiedEmail } from '../../../shared/verified-email.ts';
import type { Secret } from '../../config/secret.ts';

// The login's only door to GitHub (E10-S05): the three calls the GitHub App's user authorization needs. It is separate from
// the client port (`./github.ts`), which speaks as the App or an installation: here the credential is the client id and
// secret and, for a few hundred milliseconds, the signing-in person's own token. The token is a `Secret` from the exchange
// to the revoke, is never stored and never logged.

/** The reasons a call to GitHub can end a login (the others, `state_mismatch` and `access_denied`, are decided before). */
type ExchangeFailureReason = Extract<
  LoginFailureReason,
  'exchange_failed' | 'github_unavailable' | 'unsupported_account' | 'bad_request'
>;

/** A call ended the login. The message is fixed text: no token, address, header or body reaches it. */
export class LoginFailure extends Error {
  override readonly name = 'LoginFailure';
  readonly reason: ExchangeFailureReason;

  constructor(reason: ExchangeFailureReason) {
    super(`The login failed (${reason})`);
    this.reason = reason;
  }
}

/** The account that signed in, as far as the platform keeps it. Login, name and avatar are display snapshots. */
export interface GithubLoginProfile {
  /** The identity: the numeric GitHub id. */
  readonly githubId: GithubId;
  readonly login: string;
  readonly name: string | null;
  /** Only an address on GitHub's avatar host; else null. */
  readonly avatarUrl: string | null;
  /** The verified addresses, at most 20, captured now because no token is kept to read them later. */
  readonly verifiedEmails: readonly VerifiedEmail[];
}

/** How the best-effort revocation of the token went. `status` is GitHub's answer, null when there was none. */
export type RevokeResult = { readonly ok: true } | { readonly ok: false; readonly status: number | null };

export interface GithubLogin {
  /**
   * Trades the code of the callback (with the PKCE verifier) for the person's token.
   * @throws LoginFailure when GitHub refuses the code, cannot be reached or answers with something unexpected.
   */
  exchange(code: string, verifier: string): Promise<Secret>;
  /**
   * Who the token belongs to: `GET /user` and `GET /user/emails`.
   * @throws LoginFailure, with `unsupported_account` for an account that is not a user.
   */
  identity(token: Secret): Promise<GithubLoginProfile>;
  /** Asks GitHub to forget the token. Never throws: a failure is the result. */
  revoke(token: Secret): Promise<RevokeResult>;
}
