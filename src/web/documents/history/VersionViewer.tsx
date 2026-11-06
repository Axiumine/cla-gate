// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../auth/hooks.ts';
import { MarkdownView } from '../../components/markdown/MarkdownView.tsx';
import { useT } from '../../i18n/index.ts';
import { QueryBoundary } from '../../states/QueryBoundary.tsx';
import { Badge, Button } from '../../ui/index.ts';
import type { DocumentIds } from '../document-queries.ts';
import { formatVersion } from '../version-number.ts';
import { versionQueryOptions } from './history-queries.ts';
import { PanelHeading } from './PanelHeading.tsx';
import { RestoreAction, type RestoreActionProps } from './RestoreAction.tsx';
import { VersionFacts } from './VersionFacts.tsx';

export interface VersionViewerProps extends Pick<RestoreActionProps, 'active' | 'dispatch'> {
  readonly ids: DocumentIds;
  /** `cla_versions.id` of the version in the address. */
  readonly versionId: number;
  readonly onClose: () => void;
}

/**
 * One version read-only (E18-S11): `GET .../versions/:versionId`, its facts and its exact text drawn by the same `MarkdownView` that
 * contributors read, which keeps a hostile text inert. The server checks the text against its hash before it sends it: a version that
 * fails the check is a `500` and the state that replaces this one shows no text, only the request id. A version of another tenant or
 * document is the uniform `404`, and a `403` the forbidden state. Restoring the text of a version that is not the active one is
 * in `RestoreAction`.
 */
export function VersionViewer({ ids, versionId, active, dispatch, onClose }: VersionViewerProps) {
  const t = useT();
  const query = useQuery(versionQueryOptions(useApiClient(), ids, versionId));
  return (
    <QueryBoundary query={query} errorLevel={3}>
      {(version) => {
        const number = formatVersion(version);
        return (
          <section aria-label={t('history.viewer.title', { version: number })} className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <PanelHeading>{t('history.viewer.title', { version: number })}</PanelHeading>
              {version.active ? <Badge status="active" /> : null}
            </div>
            <VersionFacts version={version} />
            <div className="flex flex-wrap gap-3">
              <Button onClick={onClose}>{t('history.viewer.close')}</Button>
              {version.active ? null : (
                <RestoreAction ids={ids} version={version} active={active} dispatch={dispatch} />
              )}
            </div>
            <div className="rounded-md border border-line bg-surface p-4">
              <MarkdownView source={version.contentMd} headingLevel={4} />
            </div>
          </section>
        );
      }}
    </QueryBoundary>
  );
}
