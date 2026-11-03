// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';

// The contract of turning enforcement on for a repository (E14-S03): the path, the body (none) and the answer. The route, its
// tests and the screens of the dashboard share them. `:repositoryId` is `repositories.id`, never GitHub's id, and the
// installation is not in the path: the server finds it from the repository and authorises the person against it. The answer is
// built for the disable call of E14-S04 too, which says the same thing with `enabled: false`.

/** `POST`: turn enforcement on for a repository (E14-S03). */
export const REPOSITORY_ENABLE_PATH = '/api/repositories/:repositoryId/enable';

/**
 * The body of the call: none. A client that sends one anyway may send `null` or an empty object; a key nobody defined (an
 * `installationId`, say) is a `400` and never quietly ignored.
 */
export const repositoryEnableRequestSchema = z.strictObject({}).nullish();

/**
 * The answer: whether the repository enforces the CLA now, and whether the call changed it. `changed: false` is the answer to a
 * call that asked for what already was (or lost the race to one that asked first); it wrote no audit row and sent no job.
 */
export const repositoryEnabledResponseSchema = z.object({
  enabled: z.boolean(),
  changed: z.boolean(),
});
