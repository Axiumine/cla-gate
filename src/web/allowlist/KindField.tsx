// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type AllowlistEntryRequest, allowlistKindSchema } from '../../shared/allowlist.ts';
import { useT } from '../i18n/index.ts';
import { Field, RadioGroup } from '../ui/index.ts';

/** What an entry exempts: one of the three kinds of the API. */
export type EntryKind = AllowlistEntryRequest['kind'];

/** Whether the members of the organisation can be added in this scope, and if not, why. */
export type OrgMembersAvailability = 'available' | 'userAccount' | 'exists';

/** The kind a radio group reads from its string value: the values are the three kinds, so the schema reads them as they are. */
const kindOf = (value: string): EntryKind => allowlistKindSchema.parse(value);

export interface KindFieldProps {
  readonly value: EntryKind;
  readonly orgMembers: OrgMembersAvailability;
  readonly onChange: (kind: EntryKind) => void;
}

/**
 * The kind of the entry (E18-S06): a user, a bot, or the members of the organisation. The members of the organisation are offered once per
 * scope and not at all for an installation of a user account, and the choice is disabled with its reason written under the group.
 */
export function KindField({ value, orgMembers, onChange }: KindFieldProps) {
  const t = useT();
  return (
    <Field label={t('allowlist.add.kind')}>
      <RadioGroup
        value={value}
        onValueChange={(next) => {
          onChange(kindOf(next));
        }}
        options={[
          { value: 'user', label: t('allowlist.kind.user') },
          { value: 'bot', label: t('allowlist.kind.bot') },
          { value: 'org_members', label: t('allowlist.kind.org_members'), disabled: orgMembers !== 'available' },
        ]}
      />
      {orgMembers === 'available' ? null : (
        <p className="mt-2 text-sm text-fg-muted">{t(`allowlist.add.orgMembers.${orgMembers}`)}</p>
      )}
    </Field>
  );
}
