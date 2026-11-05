// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { renderId } from './encode.ts';
import type { TextPart } from './output-parts.ts';

// E09-S03: the sentences of the failure report that never change. They are written here and nowhere else, so a test can pin
// every word a contributor reads and the pull request comment of E09-S07 repeats them without a copy.

/** The invitation to sign: a Markdown link to the sign page. `url` is built by `signUrl` (src/shared/sign-link.ts). */
export function signLinkPart(url: string): TextPart {
  return { kind: 'text', text: `[Sign the CLA](${url})` };
}

/** The heading of a section, with the number of entries it lists, however many of them the list shows. */
export function countedHeading(title: string, count: number): TextPart {
  return { kind: 'text', text: `### ${title} (${renderId(count)})` };
}

/** The steps for an author whose commit email is not linked (E09-S03): the three ways out, and how to read the address. */
export const HOW_TO_FIX: TextPart = {
  kind: 'text',
  text: [
    '### How to fix',
    '',
    'Read the email of a commit with `git log -1 --format=%ae <sha>`.',
    '',
    '1. Add and verify the commit email at https://github.com/settings/emails.',
    '2. Or set a linked address and rewrite the commits with `git config user.email "<linked email>"`, ' +
      "`git rebase <base> --exec 'git commit --amend --reset-author --no-edit'` and `git push --force-with-lease`.",
    '3. Or ask a maintainer to record an exception for the listed commits (an exception never counts as a signature).',
  ].join('\n'),
};

/**
 * The line that ends every failure. The limit of one `/recheck` a minute is E07-S07's; it is stated here because no reply
 * comment is posted when it is hit.
 */
export const CLOSING_LINE: TextPart = {
  kind: 'text',
  text: 'After fixing, comment `/recheck` or use Re-run. `/recheck` can be used once per minute.',
};

/** The heading and the sentence of the advisory list. */
export const NOT_BLOCKING_INTRO: TextPart = {
  kind: 'text',
  text: '### Not blocking\n\nThese do not change the result.',
};

/**
 * What a failure that no person can fix says by itself. With no active CLA nobody can sign, and a pull request with more
 * commits than the engine reads cannot be checked; the story gives neither case a section, so each gets one sentence.
 */
export const FAILURE_NOTICES: ReadonlyMap<string, TextPart> = new Map([
  [
    'no_active_cla',
    {
      kind: 'text',
      text: 'This repository has no active CLA yet, so there is nothing to sign. The maintainers need to publish one.',
    },
  ],
  [
    'commit_limit_exceeded',
    {
      kind: 'text',
      text: 'This pull request has more commits than the check can read. Split it into smaller pull requests.',
    },
  ],
]);

/**
 * What the entry of a person says when the only thing that does not cover them is an agreement of an earlier version of the corporate CLA
 * (E21-S05). It names no company, no domain and no organisation: the way out is the CLA manager of the company, who knows who that is.
 */
export const OUTDATED_CORPORATE_NOTE =
  'an agreement of an earlier version of the corporate CLA names this account; ask the CLA manager to sign the current version';

/** The line about commits that a maintainer override covers: it names no commit and no person. */
export function overrideLine(overridden: number): TextPart {
  const [commits, verb] = overridden === 1 ? ['commit', 'is'] : ['commits', 'are'];
  return {
    kind: 'text',
    text: `${renderId(overridden)} ${commits} with an email not linked to a GitHub account ${verb} covered by a maintainer override.`,
  };
}
