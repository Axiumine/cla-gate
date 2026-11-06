// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { admissionReasonKey } from './admission-reason.ts';
import type { OperatorInstallation } from './operator-queries.ts';

/**
 * What the instance decided about the account (E18-S13): "Admitted", or "Rejected" with the reason it stored, as a sentence of the
 * catalog and as the stored code in `<code>`. Nothing in it is typed by a person.
 */
export function AdmissionCell({ installation }: { readonly installation: OperatorInstallation }) {
  const t = useT();
  if (installation.admissionStatus === 'admitted') {
    return <span>{t('operator.admission.admitted')}</span>;
  }
  const { admissionReason } = installation;
  return (
    <div className="flex flex-col gap-1">
      <span>{t('operator.admission.rejected')}</span>
      <span className="text-fg-muted">
        {t(admissionReasonKey(admissionReason))}
        {admissionReason === null ? null : (
          <>
            {' '}
            <code>{admissionReason}</code>
          </>
        )}
      </span>
    </div>
  );
}
