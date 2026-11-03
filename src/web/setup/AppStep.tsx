// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useMutation } from '@tanstack/react-query';
import { useMemo } from 'react';
import { type ManifestRequest, SETUP_ERROR_CODES, setupManifestRoute } from '../../shared/setup.ts';
import { useT } from '../i18n/index.ts';
import { AppForm } from './AppForm.tsx';
import { ManifestPost } from './ManifestPost.tsx';
import { SetupError } from './SetupError.tsx';
import { StepHeading } from './StepHeading.tsx';
import { setupClient, withSetupCode } from './setup-api.ts';

export interface AppStepProps {
  /** The CSRF token of the setup session the unlock opened. Held in memory by the page, and by nothing else. */
  readonly csrfToken: string;
}

/**
 * The second step of the setup (E19-S07): the form, and what follows it. "Create the GitHub App on GitHub" calls
 * `POST /api/setup/manifest`, and the answer is handed to GitHub by {@link ManifestPost}. A failure stays on the form with its
 * message, and the button of the form is the way to try again; a setup session that ended is `setup_locked`, with the link
 * to start again.
 */
export function AppStep({ csrfToken }: AppStepProps) {
  const t = useT();
  const client = useMemo(() => setupClient(csrfToken), [csrfToken]);
  const manifest = useMutation({
    mutationFn: (body: ManifestRequest) =>
      withSetupCode(client.call(setupManifestRoute, { body }), SETUP_ERROR_CODES.locked),
  });
  if (manifest.isSuccess) {
    return <ManifestPost actionUrl={manifest.data.actionUrl} manifest={manifest.data.manifest} />;
  }
  return (
    <div className="flex flex-col items-start gap-4">
      <StepHeading focus>{t('setup.app.title')}</StepHeading>
      <p>{t('setup.app.intro')}</p>
      <AppForm submitting={manifest.isPending} onSubmit={manifest.mutate} />
      {manifest.isError ? <SetupError error={manifest.error} /> : null}
    </div>
  );
}
