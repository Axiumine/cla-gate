// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../../i18n/index.ts';
import { StatusMessage } from '../../ui/StatusMessage.tsx';
import type { InvalidationOutcome } from './use-invalidate-control.ts';

/**
 * What the last invalidation did (E18-S14), in a polite live region that is in the page before its text changes: how many signatures
 * of which major were taken out of force, and that the pull requests of the repositories that use the document are checked again.
 * The count is the server's (`invalidated`), not the one of the preview.
 */
export function InvalidatedNotice({ outcome }: { readonly outcome: InvalidationOutcome | undefined }) {
  const t = useT();
  return (
    <StatusMessage tone={outcome === undefined ? 'neutral' : 'success'}>
      {outcome === undefined ? null : t.plural('invalidate.done', outcome.invalidated, { major: outcome.major })}
    </StatusMessage>
  );
}
