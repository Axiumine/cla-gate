// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { EmptyState, LoadingState, QueryBoundary } from '../states/index.ts';
import { CursorPager, Heading } from '../ui/index.ts';
import { DownloadMyData } from './DownloadMyData.tsx';
import { MaintainerNotice } from './MaintainerNotice.tsx';
import { SignaturesTable } from './SignaturesTable.tsx';
import { type SignaturesPageInput, useSignaturesPage } from './use-signatures-page.ts';

/**
 * The page at `/me/signatures` (E18-S03): the CLAs the signed-in person signed, in every org of the instance, newest first, 25 to
 * a page, from `GET /api/me/signatures`. The person is the one of the session and the request names nobody else. Loading, the
 * first error and a failed refetch come from `QueryBoundary`; the pager keeps the page on screen while the next one loads and when
 * it fails to, and says so. A cursor in the address that the server refuses, on a page that was opened with it (a reload, a
 * pasted link), is answered with the first page.
 */
export function MySignaturesPage(props: SignaturesPageInput) {
  const t = useT();
  const { query, shown, keptPage, cursorRefused, goTo } = useSignaturesPage(props);
  const listing =
    keptPage === undefined ? (
      <QueryBoundary
        query={query}
        isEmpty={(page) => page.items.length === 0}
        empty={
          <EmptyState
            level={2}
            title={t('me.signatures.empty.title')}
            description={t('me.signatures.empty.description')}
          />
        }
      >
        {(page) => <SignaturesTable items={page.items} />}
      </QueryBoundary>
    ) : (
      <SignaturesTable items={keptPage.items} />
    );
  return (
    <div className="flex flex-col gap-6">
      <Heading level={1}>{t('me.signatures.title')}</Heading>
      <MaintainerNotice />
      <DownloadMyData />
      {cursorRefused ? <LoadingState /> : listing}
      {shown === undefined || shown.items.length === 0 ? null : (
        <CursorPager
          cursor={props.cursor}
          nextCursor={shown.nextCursor}
          onCursorChange={goTo}
          loading={query.isFetching}
          failed={keptPage !== undefined}
        />
      )}
    </div>
  );
}
