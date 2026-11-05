// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Ref } from 'react';
import type { SignContextResponse } from '../../shared/sign-context.ts';
import { AlreadySigned } from './AlreadySigned.tsx';
import { ResignRequired } from './ResignRequired.tsx';
import { RevokedNotice } from './RevokedNotice.tsx';
import type { Notice } from './sign-situation.ts';

// The notices above the CLA text (E18-S02): the person already signed, must sign a new major version, or had a signature
// revoked. Each has a heading of its own, which takes focus when the state changes under the person.

export interface SignNoticeProps {
  readonly notice: Notice;
  readonly context: SignContextResponse;
  readonly headingRef: Ref<HTMLHeadingElement> | undefined;
}

/** The notice of the situation (nothing for `none`). */
export function SignNotice({ notice, context, headingRef }: SignNoticeProps) {
  switch (notice.kind) {
    case 'signed':
      return <AlreadySigned notice={notice} context={context} headingRef={headingRef} />;
    case 'resign':
      return <ResignRequired notice={notice} context={context} headingRef={headingRef} />;
    case 'revoked':
      return <RevokedNotice notice={notice} context={context} headingRef={headingRef} />;
    case 'none':
      return null;
  }
}
