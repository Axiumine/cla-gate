// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type Ref, useState } from 'react';
import type { SignContextResponse } from '../../shared/sign-context.ts';
import { EmployerClaim } from '../corporate/EmployerClaim.tsx';
import { CannotSign, NoVerifiedEmail } from './BlockedPanel.tsx';
import { Confirmation, type Signed } from './Confirmation.tsx';
import { ConsentForm } from './ConsentForm.tsx';
import { signReturnTo } from './params.ts';
import type { Action } from './sign-situation.ts';

export interface SignActionProps {
  readonly context: SignContextResponse;
  readonly action: Action;
  /** The heading of the action, when it is the heading that takes focus on a change of state. */
  readonly headingRef: Ref<HTMLHeadingElement> | undefined;
  /** Loads the context in force again and shows it, then moves the page to its start; resolves true when it is there. */
  readonly review: () => Promise<boolean>;
  /** Loads the context again; resolves true when the new one is there. */
  readonly reload: () => Promise<boolean>;
  /** The context is being loaded again. */
  readonly reloading: boolean;
  /** The CLA stopped being in force while the person was signing. */
  readonly onNoActiveCla: () => void;
}

/**
 * What the person can do about the CLA on screen (E18-S01, E18-S02): the consent form, which the confirmation replaces once the
 * signature is recorded; instructions for a person with no verified address; or nothing at all, for a person who already signed.
 * Under the form and under the instructions for a missing address stands the entry "Contributing for an employer?" (E21-S04), which is there only when the
 * repository offers the claim; it is asked for the repository of the context, and a person who signed, or who is covered already, has no use for it.
 */
export function SignAction({ context, action, headingRef, review, reload, reloading, onNoActiveCla }: SignActionProps) {
  const [signed, setSigned] = useState<Signed | undefined>(undefined);
  const claim = <EmployerClaim githubRepoId={context.repository.githubRepoId} />;
  switch (action) {
    case 'form':
      return signed === undefined ? (
        <>
          <ConsentForm
            context={context}
            headingRef={headingRef}
            reloading={reloading}
            handlers={{ onSigned: setSigned, onNoActiveCla, review }}
          />
          {claim}
        </>
      ) : (
        <Confirmation signed={signed} prUrl={context.prUrl} />
      );
    case 'blocked':
      return (
        <>
          <NoVerifiedEmail
            headingRef={headingRef}
            reload={reload}
            reloading={reloading}
            returnTo={signReturnTo(context.repository.githubRepoId, context.pr ?? undefined)}
          />
          {claim}
        </>
      );
    case 'cannot':
      return <CannotSign headingRef={headingRef} reload={reload} reloading={reloading} />;
    case 'none':
      return null;
  }
}
