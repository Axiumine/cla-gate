// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import {
  CLA_DOCUMENT_KINDS,
  type ClaDocumentKind,
  createDocumentRequestSchema,
  isKindSupported,
} from '../../shared/cla.ts';
import { useT } from '../i18n/index.ts';
import { Field, Select } from '../ui/index.ts';

/** The kinds a document can be created with now: the ones the server accepts. */
const KINDS = CLA_DOCUMENT_KINDS.filter((kind) => isKindSupported(kind));

/** The kind that a choice of the select stands for: its values are the kinds above, so the schema reads them as they are. */
const kindOf = (value: string): ClaDocumentKind => createDocumentRequestSchema.shape.kind.parse(value);

export interface KindFieldProps {
  readonly value: ClaDocumentKind;
  readonly rule: 'kind_not_supported' | undefined;
  readonly onChange: (kind: ClaDocumentKind) => void;
}

/** The kind of the document (E18-S05): only the kinds the server accepts are offered, and a refusal of the kind is shown under it. */
export function KindField({ value, rule, onChange }: KindFieldProps) {
  const t = useT();
  return (
    <Field label={t('documents.new.kind')} error={rule === undefined ? undefined : t(`documents.rule.${rule}`)}>
      <Select
        options={KINDS.map((kind) => ({ value: kind, label: t(`documents.kind.${kind}`) }))}
        value={value}
        onChange={(event) => {
          onChange(kindOf(event.target.value));
        }}
      />
    </Field>
  );
}
