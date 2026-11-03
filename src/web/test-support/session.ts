// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { z } from 'zod';
import type { sessionResponseSchema } from '../../shared/auth.ts';

// Made-up sessions for the tests of the auth layer (E17-S08). Nothing here is a real token or a real account.

/** A CSRF token as the server mints them: 43 base64url characters; it is distinctive, so a test can search for it. */
export const CSRF_TOKEN = `${'t0k3n'.repeat(8)}abc`;

/** The answer of `GET /api/auth/session` for a logged-in person, with an avatar on GitHub's avatar host. */
export const ALICE: z.input<typeof sessionResponseSchema> = {
  user: {
    githubId: 4711,
    login: 'octocat',
    name: 'The Octocat',
    avatarUrl: 'https://avatars.githubusercontent.com/u/4711?v=4',
  },
  expiresAt: '2026-11-02T10:00:00.000Z',
  csrfToken: CSRF_TOKEN,
};
