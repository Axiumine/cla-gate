// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { EmptyState, QueryBoundary } from '../states/index.ts';
import { CursorPager } from '../ui/CursorPager.tsx';
import { DataTable } from '../ui/DataTable.tsx';
import { Heading } from '../ui/Heading.tsx';
import { agreementColumns } from './agreement-columns.tsx';
import { useAgreements } from './use-agreements.ts';

export interface CorporateAgreementsPageProps {
  /** The cursor of the page on screen, from the address; absent for the first page. Opaque. */
  readonly cursor: string | undefined;
  /** Puts the cursor of the page to show into the address. */
  readonly onCursorChange: (cursor: string | undefined) => void;
}

/**
 * The page at `/corporate/agreements` (E21-S02), for a signed-in person: the corporate agreements they signed, in every
 * organisation, newest first, a page at a time. The company, the title, the document and the organisation are text that
 * people control, so they are drawn through `UserText`; a company erased from the records is shown as erased.
 */
export function CorporateAgreementsPage({ cursor, onCursorChange }: CorporateAgreementsPageProps) {
  const t = useT();
  const query = useAgreements(cursor);
  return (
    <div className="flex flex-col items-start gap-4">
      <Heading level={1}>{t('corporate.agreements.title')}</Heading>
      <QueryBoundary
        query={query}
        isEmpty={(page) => page.items.length === 0 && cursor === undefined}
        empty={
          <EmptyState
            level={2}
            title={t('corporate.agreements.emptyTitle')}
            description={t('corporate.agreements.emptyDescription')}
          />
        }
      >
        {(page) => (
          <div className="flex w-full flex-col gap-4">
            <div className="w-full overflow-x-auto">
              <DataTable
                caption={t('corporate.agreements.caption')}
                columns={agreementColumns(t)}
                rows={page.items}
                rowKey={(row) => String(row.id)}
              />
            </div>
            <CursorPager
              cursor={cursor}
              nextCursor={page.nextCursor}
              onCursorChange={onCursorChange}
              loading={query.isFetching}
              failed={query.isError}
            />
          </div>
        )}
      </QueryBoundary>
    </div>
  );
}
