// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../../auth/hooks.ts';
import { useT } from '../../i18n/index.ts';
import { QueryBoundary } from '../../states/QueryBoundary.tsx';
import { Button, Field, Select } from '../../ui/index.ts';
import type { DocumentIds } from '../document-queries.ts';
import { choiceOptions, defaultPair } from './compare-pair.ts';
import { DiffView } from './DiffView.tsx';
import {
  comparisonQueryOptions,
  type VersionPair,
  type VersionSummary,
  versionChoicesQueryOptions,
} from './history-queries.ts';
import { PanelHeading } from './PanelHeading.tsx';

export interface VersionCompareProps {
  readonly ids: DocumentIds;
  /** The pair the address names, or `undefined` for the default one. */
  readonly pair: VersionPair | undefined;
  readonly onPairChange: (pair: VersionPair) => void;
  readonly onClose: () => void;
}

interface PairProps {
  readonly ids: DocumentIds;
  readonly versions: readonly VersionSummary[];
  readonly pair: VersionPair;
  readonly onPairChange: (pair: VersionPair) => void;
}

/** The text of the two versions, read together, and their diff: a read that fails is the error state and shows none of the text. */
function Comparison({ ids, pair }: Pick<PairProps, 'ids' | 'pair'>) {
  const query = useQuery(comparisonQueryOptions(useApiClient(), ids, pair));
  return (
    <QueryBoundary query={query} errorLevel={4}>
      {({ from, to }) => <DiffView from={from} to={to} />}
    </QueryBoundary>
  );
}

/** The two choices of the comparison, each over the newest versions of the document; changing one keeps the other. */
function PairChoices({ versions, pair, onPairChange }: Omit<PairProps, 'ids'>) {
  const t = useT();
  const options = choiceOptions(versions, [pair.from, pair.to], t);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t('history.compare.from')}>
        <Select
          value={String(pair.from)}
          options={options}
          onChange={(event) => {
            onPairChange({ from: Number(event.target.value), to: pair.to });
          }}
        />
      </Field>
      <Field label={t('history.compare.to')}>
        <Select
          value={String(pair.to)}
          options={options}
          onChange={(event) => {
            onPairChange({ from: pair.from, to: Number(event.target.value) });
          }}
        />
      </Field>
    </div>
  );
}

/**
 * Two versions side by side as a line diff (E18-S11): the choices (default: the active version against the one before it), taken from
 * the newest versions of the document, and the diff of the two texts. A document with fewer than two versions has nothing to compare,
 * and says so. The pair is in the address (`from`, `to`), so a comparison is shared by its link.
 */
export function VersionCompare({ ids, pair, onPairChange, onClose }: VersionCompareProps) {
  const t = useT();
  const choices = useQuery(versionChoicesQueryOptions(useApiClient(), ids));
  return (
    <section aria-label={t('history.compare.title')} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <PanelHeading>{t('history.compare.title')}</PanelHeading>
        <Button onClick={onClose}>{t('history.compare.close')}</Button>
      </div>
      <QueryBoundary query={choices} errorLevel={4}>
        {(versions) => {
          const current = pair ?? defaultPair(versions);
          return current === undefined ? (
            <p>{t('history.compare.needTwo')}</p>
          ) : (
            <>
              <PairChoices versions={versions} pair={current} onPairChange={onPairChange} />
              <Comparison ids={ids} pair={current} />
            </>
          );
        }}
      </QueryBoundary>
    </section>
  );
}
