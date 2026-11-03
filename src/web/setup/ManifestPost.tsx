// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useEffect, useRef } from 'react';
import type { AppManifest } from '../../shared/setup.ts';
import { useT } from '../i18n/index.ts';
import { Button } from '../ui/Button.tsx';
import { isGithubAddress } from './github-links.ts';
import { StartAgainLink } from './StartAgainLink.tsx';
import { StepHeading } from './StepHeading.tsx';

export interface ManifestPostProps {
  /** Where the manifest is posted: GitHub's page for creating an App, with the `state` in its query. */
  readonly actionUrl: string;
  readonly manifest: AppManifest;
}

/**
 * Hands the manifest to GitHub (E19-S07): a real `<form method="post" action>` with the manifest in a hidden input named
 * `manifest`, submitted with `requestSubmit()` as soon as the step appears; no script is written into the page, which the
 * policy forbids. The button in the form is there for the case that the browser did not send it by itself. The form is
 * submitted once, however often React runs the effect. Before anything is sent the address is checked to be one on
 * `https://github.com/`; if it is not, nothing is posted and the step says so.
 */
export function ManifestPost({ actionUrl, manifest }: ManifestPostProps) {
  const t = useT();
  const form = useRef<HTMLFormElement>(null);
  const submitted = useRef(false);
  const allowed = isGithubAddress(actionUrl);
  useEffect(() => {
    if (allowed && !submitted.current) {
      submitted.current = true;
      form.current?.requestSubmit();
    }
  }, [allowed]);
  if (!allowed) {
    return (
      <div className="flex flex-col items-start gap-4">
        <StepHeading focus>{t('setup.post.title')}</StepHeading>
        <p role="alert">{t('setup.post.refused')}</p>
        <StartAgainLink />
      </div>
    );
  }
  return (
    <div className="flex flex-col items-start gap-4">
      <StepHeading focus>{t('setup.post.title')}</StepHeading>
      <p>{t('setup.post.intro')}</p>
      <form ref={form} method="post" action={actionUrl}>
        <input type="hidden" name="manifest" value={JSON.stringify(manifest)} />
        <Button type="submit" variant="primary">
          {t('setup.post.continue')}
        </Button>
      </form>
    </div>
  );
}
