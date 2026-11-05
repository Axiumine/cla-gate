// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Button, DialogClose } from '../ui/index.ts';
import { FOOTER_CLASSES } from '../ui/overlay.tsx';
import { AddFailure } from './AddFailure.tsx';
import { KindField, type OrgMembersAvailability } from './KindField.tsx';
import { LoginField } from './LoginField.tsx';
import { OrgMembersConfirm } from './OrgMembersConfirm.tsx';
import { type AddEntryInput, useAddEntry } from './use-add-entry.ts';

export interface AddEntryFormProps extends AddEntryInput {
  readonly orgMembers: OrgMembersAvailability;
}

/**
 * The form of the add dialog (E18-S06): the kind, and for a user or a bot the GitHub login, which is all the server needs (it looks the
 * account up and keeps its numeric id). The members of the organisation take no login and ask a question first. A rule the server refuses
 * the add with is shown where the person was typing or above the buttons; the typed values stay.
 */
export function AddEntryForm({ orgMembers, ...input }: AddEntryFormProps) {
  const t = useT();
  const form = useAddEntry(input);
  return (
    <form onSubmit={form.submit} noValidate className="flex flex-col gap-4">
      <KindField
        value={form.values.kind}
        orgMembers={orgMembers}
        onChange={(kind) => {
          form.change({ kind });
        }}
      />
      {form.values.kind === 'org_members' ? null : (
        <LoginField
          value={form.values.login}
          rule={form.loginRule}
          onChange={(login) => {
            form.change({ login });
          }}
        />
      )}
      <AddFailure error={form.failure} retry={form.sendValues} retrying={form.pending} />
      <div className={FOOTER_CLASSES}>
        <DialogClose>
          <Button variant="secondary">{t('common.cancel')}</Button>
        </DialogClose>
        <Button type="submit" variant="primary" loading={form.pending}>
          {t('allowlist.add.submit')}
        </Button>
      </div>
      <OrgMembersConfirm open={form.confirming} onOpenChange={form.setConfirming} onConfirm={form.sendValues} />
    </form>
  );
}
