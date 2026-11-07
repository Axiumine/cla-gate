// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { COMPANY_NAME_MAX_CODE_POINTS, SIGNATORY_TITLE_MAX_CODE_POINTS } from '../../shared/corporate-text.ts';
import { SIGNER_NAME_MAX_CODE_POINTS } from '../../shared/signer-input.ts';
import { useT } from '../i18n/index.ts';
import type { SignEntriesProps } from './entries.ts';
import { TextEntry } from './TextEntry.tsx';

/** The company, the title and the name the signatory types. */
export function TextEntries({ entries, attempted, onChange }: SignEntriesProps) {
  const t = useT();
  return (
    <>
      <TextEntry
        label={t('corporate.sign.company')}
        description={t('corporate.sign.companyHelp')}
        autoComplete="organization"
        maxLength={COMPANY_NAME_MAX_CODE_POINTS}
        value={entries.companyName}
        attempted={attempted}
        onChange={(companyName) => {
          onChange({ companyName });
        }}
      />
      <TextEntry
        label={t('corporate.sign.titleField')}
        description={t('corporate.sign.titleHelp')}
        autoComplete="organization-title"
        maxLength={SIGNATORY_TITLE_MAX_CODE_POINTS}
        value={entries.signatoryTitle}
        attempted={attempted}
        onChange={(signatoryTitle) => {
          onChange({ signatoryTitle });
        }}
      />
      <TextEntry
        label={t('corporate.sign.typedName')}
        description={t('corporate.sign.typedNameHelp')}
        autoComplete="name"
        maxLength={SIGNER_NAME_MAX_CODE_POINTS}
        value={entries.typedName}
        attempted={attempted}
        onChange={(typedName) => {
          onChange({ typedName });
        }}
      />
    </>
  );
}
