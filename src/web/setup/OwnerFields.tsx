// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Field } from '../ui/Field.tsx';
import { RadioGroup } from '../ui/RadioGroup.tsx';
import { TextInput } from '../ui/TextInput.tsx';
import type { AppFormField, AppFormValues, OwnerType } from './app-form.ts';

/** The owner picker and, for an organisation, the field for its login (E19-S07). */
export function OwnerFields(props: {
  readonly values: AppFormValues;
  readonly wrong: ReadonlySet<AppFormField>;
  readonly change: (next: Partial<AppFormValues>) => void;
}) {
  const t = useT();
  const { values, wrong, change } = props;
  return (
    <>
      <Field label={t('setup.app.owner')}>
        <RadioGroup
          value={values.ownerType}
          onValueChange={(value) => {
            const ownerType: OwnerType = value === 'organisation' ? 'organisation' : 'user';
            change({ ownerType });
          }}
          options={[
            { value: 'user', label: t('setup.app.ownerUser') },
            { value: 'organisation', label: t('setup.app.ownerOrganisation') },
          ]}
        />
      </Field>
      {values.ownerType === 'organisation' ? (
        <Field
          label={t('setup.app.organisation')}
          description={t('setup.app.organisationHelp')}
          error={wrong.has('organisation') ? t('setup.app.organisationInvalid') : undefined}
          required
        >
          <TextInput
            autoComplete="off"
            spellCheck={false}
            value={values.organisation}
            onChange={(event) => {
              change({ organisation: event.target.value });
            }}
          />
        </Field>
      ) : null}
    </>
  );
}
