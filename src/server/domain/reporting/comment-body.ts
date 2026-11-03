// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { CHECK_RUN_NAME } from '../../../shared/check.ts';

// E09-S06: the pull request comment of the platform. It begins with a marker line, which is how the comment is recognised as
// ours (E09-S07 adds the failure and success bodies). The marker is built from the check name, so it cannot drift from it, and
// it is fixed text: no name a person wrote is ever part of it.

/**
 * The first line of every comment the platform writes.
 * @internal Exported for the tests, and for the bodies of E09-S07 (Knip ignores `@internal` exports in production mode).
 */
export const COMMENT_MARKER = `<!-- cla-platform:${CHECK_RUN_NAME}:v1 -->`;

/** What a comment says once the maintainers turned enforcement off for the repository. */
const DISABLED_NOTICE = 'CLA enforcement is disabled for this repository.';

/** The body of the comment of a repository whose enforcement is off: the marker line, then the one-line notice. */
export function disabledCommentBody(): string {
  return `${COMMENT_MARKER}\n${DISABLED_NOTICE}`;
}
