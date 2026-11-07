// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { CHECK_RUN_NAME } from '../../../shared/check.ts';
import { corporateLine } from './check-output.ts';
import { shortSha } from './encode.ts';
import { type OutputPart, renderParts } from './output-parts.ts';

// E09-S06, E09-S07: the pull request comment of the platform. It begins with a marker line, which is how the comment is
// recognised as ours (with the id of the App that posted it, which only GitHub sets). The marker is built from the check name, so
// it cannot drift from it, and it is fixed text: no name a person wrote is ever part of it (E09-S01 keeps a name from spelling it).
// The failure body is made of the same already encoded parts as the failure summary of the Check Run, so both print the same
// words; the success body is one sentence. Every body is capped like a Check Run summary.

/** The first line of every comment the platform writes. */
export const COMMENT_MARKER = `<!-- cla-platform:${CHECK_RUN_NAME}:v1 -->`;

/** What a comment says once the maintainers turned enforcement off for the repository. */
const DISABLED_NOTICE = 'CLA enforcement is disabled for this repository.';

/** The heading of the comment of a pull request that did not pass. */
const FAILURE_HEADING = '## CLA check failed';

/** The last line of a failure comment: it names the check and says the words are rewritten, so a person knows an edit does not last. */
const CHECK_LINE: OutputPart = {
  kind: 'text',
  text: `This comment is rewritten on every evaluation of the \`${CHECK_RUN_NAME}\` check.`,
};

/**
 * What the comment of a pull request says about its latest evaluation: the parts of the failure report (E09-S03), or that the
 * contributors of the commit are covered. `corporate` is how many of them an approval of a corporate CLA covers (E21-S05; none when
 * left out): a number, never a name, a company, a domain or an organisation.
 */
export type CommentContent =
  | { readonly kind: 'failure'; readonly summary: readonly OutputPart[] }
  | { readonly kind: 'success'; readonly headSha: string; readonly corporate?: number };

/** The body of the comment of a repository whose enforcement is off: the marker line, then the one-line notice. */
export function disabledCommentBody(): string {
  return `${COMMENT_MARKER}\n${DISABLED_NOTICE}`;
}

/** The sentence of a passing comment: that the contributors signed, and, when a corporate CLA covers some, the count of those. */
function successSentence(content: Extract<CommentContent, { kind: 'success' }>): string {
  const commit = shortSha(content.headSha);
  const corporate = corporateLine(content.corporate ?? 0);
  return corporate === null
    ? `All contributors have signed the CLA for commit ${commit}.`
    : `All contributors have signed the CLA or are covered by a corporate CLA for commit ${commit}. ${corporate}`;
}

/**
 * The body of the comment of a pull request: the marker line first, then, for a failure, the heading, the parts of the report (the
 * sign link, the sections, the fix steps, the closing line) and a last line that names the check, cut at an entry boundary
 * when the whole would pass 60 000 UTF-16 code units; or, for a success, the sentence that the contributors have signed, or
 * (when a corporate CLA covers some of them) that they have signed or are covered by a corporate CLA, with the count.
 * @throws InvalidShaError for a head SHA that is not a full SHA, OutputTooLongError when the fixed text alone does not fit.
 */
export function commentBody(content: CommentContent): string {
  if (content.kind === 'success') {
    return `${COMMENT_MARKER}\n${successSentence(content)}`;
  }
  return renderParts([{ kind: 'text', text: `${COMMENT_MARKER}\n${FAILURE_HEADING}` }, ...content.summary, CHECK_LINE]);
}
