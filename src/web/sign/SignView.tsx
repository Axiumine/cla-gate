// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useRef, useState } from 'react';
import type { SignContextResponse } from '../../shared/sign-context.ts';
import { MarkdownView } from '../components/markdown/MarkdownView.tsx';
import { useT } from '../i18n/index.ts';
import { Fingerprint } from './Fingerprint.tsx';
import { NoActiveCla } from './NoActiveCla.tsx';
import { SignAction } from './SignAction.tsx';
import { SignHeader } from './SignHeader.tsx';
import { SignNotice } from './SignNotice.tsx';
import { situationOf } from './sign-situation.ts';
import { useFocusOnChange } from './use-focus.ts';

export interface SignViewProps {
  readonly context: SignContextResponse;
  /** Asks for the context again; resolves true when the new one is there. */
  readonly reload: () => Promise<boolean>;
  /** The context is being asked for. */
  readonly reloading: boolean;
}

/**
 * The sign page once the context is there (E18-S01, E18-S02): the document name as the page's one `h1`, the version and when it
 * was published, the notice for the person's situation (already signed, a new major version, a revocation), the CLA text in a
 * region a keyboard can scroll, its fingerprint, and what the person can do: the consent form, the instructions for a missing
 * verified address, or nothing. Every string a person controls (the document name, the repository, the rationale) goes through
 * `UserText`; the CLA text goes through `MarkdownView`, and nothing else sets markup. When the state changes under the person
 * (they can sign now, they must sign again), focus moves to the heading of the new state.
 */
export function SignView({ context, reload, reloading }: SignViewProps) {
  const t = useT();
  const [withdrawn, setWithdrawn] = useState(false);
  const title = useRef<HTMLHeadingElement>(null);
  const stateHeading = useRef<HTMLHeadingElement>(null);
  const { notice, action } = situationOf(context);
  // The first heading of the state is the one to focus: the notice when there is one, else what stands in for the form.
  const owner = notice.kind === 'none' ? action : notice.kind;
  useFocusOnChange(`${notice.kind}:${action}`, stateHeading);
  // The person read a new version: it replaces the one they saw, and they start at its top.
  const review = async (): Promise<boolean> => {
    const loaded = await reload();
    if (loaded) {
      window.scrollTo({ top: 0 });
      title.current?.focus();
    }
    return loaded;
  };
  if (withdrawn) {
    return <NoActiveCla replacedPage />;
  }
  return (
    <div className="flex flex-col gap-6">
      <SignHeader context={context} titleRef={title} />
      <SignNotice notice={notice} context={context} headingRef={owner === notice.kind ? stateHeading : undefined} />
      <article
        aria-label={t('sign.text.label')}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the text scrolls, and a region that scrolls must take focus for a keyboard user (E18-S01)
        tabIndex={0}
        className="max-h-[60vh] overflow-y-auto rounded-lg border border-line bg-surface p-4"
      >
        <MarkdownView source={context.version.contentMd} />
      </article>
      <Fingerprint sha256={context.version.contentSha256} />
      <SignAction
        context={context}
        action={action}
        headingRef={owner === action ? stateHeading : undefined}
        review={review}
        reload={reload}
        reloading={reloading}
        onNoActiveCla={() => {
          setWithdrawn(true);
        }}
      />
    </div>
  );
}
