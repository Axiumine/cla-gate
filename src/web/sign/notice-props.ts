// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { Ref } from 'react';
import type { SignContextResponse } from '../../shared/sign-context.ts';
import type { Notice } from './sign-situation.ts';

/** What a notice is drawn from: the notice itself, the context it belongs to, and its heading, which the page focuses when the state changes (E18-S02). */
export interface NoticeProps<Kind extends Notice['kind']> {
  readonly notice: Extract<Notice, { readonly kind: Kind }>;
  readonly context: SignContextResponse;
  readonly headingRef: Ref<HTMLHeadingElement> | undefined;
}
