// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Timestamp } from '../i18n/Timestamp.tsx';
import type { OperatorInstallation } from './operator-queries.ts';

/** The times that exist for an installation, in UTC and each with its name (E18-S13): decided, suspended, deleted. None at all says so. */
export function TimesCell({ installation }: { readonly installation: OperatorInstallation }) {
  const t = useT();
  const times = [
    { label: t('operator.time.decided'), value: installation.admissionDecidedAt },
    { label: t('operator.time.suspended'), value: installation.suspendedAt },
    { label: t('operator.time.deleted'), value: installation.deletedAt },
  ].flatMap(({ label, value }) => (value === null ? [] : [{ label, value }]));
  if (times.length === 0) {
    return <span className="text-fg-muted">{t('operator.time.none')}</span>;
  }
  return (
    <dl className="flex flex-col gap-1">
      {times.map(({ label, value }) => (
        <div key={label} className="flex flex-wrap gap-x-2">
          <dt className="text-fg-muted">{label}</dt>
          <dd>
            <Timestamp value={value} utc />
          </dd>
        </div>
      ))}
    </dl>
  );
}
