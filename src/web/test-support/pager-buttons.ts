// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { screen } from '@testing-library/react';
import { messages } from '../i18n/index.ts';

/** The Next button of the pager of the screen. */
export const nextButton = () => screen.getByRole('button', { name: messages['pager.next'] });

/** The Previous button of the pager of the screen. */
export const previousButton = () => screen.getByRole('button', { name: messages['pager.previous'] });
