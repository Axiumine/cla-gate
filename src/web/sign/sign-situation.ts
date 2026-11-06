// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { SignContextResponse } from '../../shared/sign-context.ts';

// What the sign page shows for a context that loaded (E18-S02), decided in one place. The `state` of the context and its
// `blockedReason` are closed sets (zod enums in the contract of E13-S02), and each is switched over below with no default and a
// return type that has no `undefined`: a value added to either set leaves a path without a return and fails `tsc`.

/** The signature that covers the person, or covered them before the document moved on a major version. */
type Signature = SignContextResponse['signature'];

/**
 * The notice above the text: the person already signed, must sign a new major version, or had a signature revoked. It carries
 * what its text is about, so the notice never has to look for it in the context again.
 */
export type Notice =
  | { readonly kind: 'signed'; readonly signature: Signature }
  | { readonly kind: 'resign'; readonly signature: Signature }
  | { readonly kind: 'revoked'; readonly revokedAt: string }
  | { readonly kind: 'none' };

/** What takes the place of the form, or the form itself. */
export type Action = 'form' | 'blocked' | 'cannot' | 'none';

export interface Situation {
  readonly notice: Notice;
  readonly action: Action;
}

/** Whether the person can sign: GitHub reported a verified address, or the reason it did not. */
function actionOf(context: SignContextResponse): Action {
  switch (context.blockedReason) {
    case 'no_verified_email':
      return 'blocked';
    case null:
      return context.canSign ? 'form' : 'cannot';
  }
}

/** The notice of a person who may sign: the revocation of their newest signature on the document, when there is one. */
function revocationOf(context: SignContextResponse): Notice {
  return context.revoked === null ? { kind: 'none' } : { kind: 'revoked', revokedAt: context.revoked.revokedAt };
}

/**
 * The notice and the action of a context. `already_signed` has no action at all (nothing to sign); `resign_required` has the
 * notice of the new major version; `ready` has the notice of a revocation when the person's newest signature on the document
 * was revoked, and none otherwise.
 */
export function situationOf(context: SignContextResponse): Situation {
  switch (context.state) {
    case 'already_signed':
      return { notice: { kind: 'signed', signature: context.signature }, action: 'none' };
    case 'resign_required':
      return { notice: { kind: 'resign', signature: context.signature }, action: actionOf(context) };
    case 'ready':
      return { notice: revocationOf(context), action: actionOf(context) };
  }
}
