// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { expect } from 'vitest';
import { messages } from '../i18n/index.ts';

/** What a test holds of a confirmation question (the invalidation, the erasure): the question that is open and its confirm button. */
export interface QuestionHandles {
  readonly question: () => HTMLElement;
  readonly confirmButton: () => HTMLElement;
}

/**
 * The person confirms and the server answers `403`: the refusal is an alert inside the question, with no "Try again" (asking
 * again cannot change it), and the question stays open.
 */
export async function confirmIntoForbidden(
  user: UserEvent,
  { question, confirmButton }: QuestionHandles,
): Promise<void> {
  await user.click(confirmButton());
  const alert = await within(question()).findByRole('alert');
  expect(alert).toHaveTextContent(messages['errors.forbidden']);
  expect(within(alert).queryByRole('button', { name: messages['states.retry'] })).toBeNull();
  expect(question()).toBeInTheDocument();
}
