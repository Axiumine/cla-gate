// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { useT } from '../i18n/index.ts';
import { Field, TextInput } from '../ui/index.ts';
import type { AddRule } from './allowlist-rules.ts';

export interface LoginFieldProps {
  readonly value: string;
  /** What is wrong with the login, as the catalog key of its words: the pattern before any request, or a rule the server broke. */
  readonly rule: 'invalid_login' | AddRule | undefined;
  readonly onChange: (login: string) => void;
}

/**
 * The GitHub login of a user or a bot (E18-S06). It is checked against the shared pattern before anything is sent; the server looks the
 * account up and stores its numeric id, so there is no look-up step here and no email field.
 */
export function LoginField({ value, rule, onChange }: LoginFieldProps) {
  const t = useT();
  return (
    <Field
      label={t('allowlist.add.login')}
      description={t('allowlist.add.loginHelp')}
      required
      error={rule === undefined ? undefined : t(`allowlist.rule.${rule}`)}
    >
      <TextInput
        value={value}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </Field>
  );
}
