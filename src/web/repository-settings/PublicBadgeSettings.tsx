// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { publicVerificationRoute } from '../../shared/public-verification.ts';
import { useApiClient } from '../auth/index.ts';
import { useT } from '../i18n/index.ts';
import { ErrorState, QueryBoundary } from '../states/index.ts';
import { Checkbox } from '../ui/Checkbox.tsx';
import { Field } from '../ui/Field.tsx';
import { Heading } from '../ui/Heading.tsx';
import { StatusMessage } from '../ui/StatusMessage.tsx';
import { BadgeSnippet } from './BadgeSnippet.tsx';
import { badgeKey, badgeQueryOptions, type RepositoryIds } from './badge-state.ts';

/**
 * The public badge of a repository on its settings screen (E22-S03): the switch of the opt-in (`PUT .../public-verification`), and,
 * while it is on, the snippet to paste into a README with a copy button for each form. The state is read from the snippet call, which
 * is `409 public_verification_disabled` while the switch is off, so the screen needs no second request and never shows a snippet for a
 * switch that is off. A change is asked of the server, never assumed: the switch follows the answer, and the screen reads the state
 * again. A role that may not change the settings gets the forbidden state, and a repository that is gone the not-found one.
 */
export function PublicBadgeSettings({ installationId, repositoryId }: RepositoryIds) {
  const t = useT();
  const client = useApiClient();
  const queryClient = useQueryClient();
  const ids = { installationId, repositoryId };
  const query = useQuery(badgeQueryOptions(client, ids));
  const [message, setMessage] = useState('');
  const change = useMutation({
    mutationFn: (enabled: boolean) => client.call(publicVerificationRoute, { params: ids, body: { enabled } }),
    onSuccess: async ({ enabled }) => {
      await queryClient.invalidateQueries({ queryKey: badgeKey(ids) });
      setMessage(t(enabled ? 'repository.badge.turnedOn' : 'repository.badge.turnedOff'));
    },
  });
  return (
    <section aria-labelledby="public-badge-title" className="flex flex-col items-start gap-4">
      <div id="public-badge-title">
        <Heading level={2}>{t('repository.badge.title')}</Heading>
      </div>
      <p>{t('repository.badge.intro')}</p>
      <QueryBoundary query={query}>
        {(state) => (
          <div className="flex w-full flex-col gap-4">
            <Field label={t('repository.badge.toggle')} description={t('repository.badge.enforcement')} inline>
              <Checkbox
                checked={state.enabled}
                disabled={change.isPending}
                onCheckedChange={(enabled) => {
                  change.mutate(enabled);
                }}
              />
            </Field>
            {change.isError ? <ErrorState variant="banner" error={change.error} /> : null}
            {state.enabled ? (
              <>
                <Heading level={3}>{t('repository.badge.pasteTitle')}</Heading>
                <BadgeSnippet markdown={state.markdown} html={state.html} announce={setMessage} />
              </>
            ) : (
              <p>{t('repository.badge.offHint')}</p>
            )}
          </div>
        )}
      </QueryBoundary>
      <StatusMessage>{message}</StatusMessage>
    </section>
  );
}
