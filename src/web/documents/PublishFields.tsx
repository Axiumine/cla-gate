// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { publishVersionRequestSchema, type VersionBump } from '../../shared/cla-version.ts';
import { useT } from '../i18n/index.ts';
import { Field, RadioGroup, Textarea } from '../ui/index.ts';
import type { ForcedMajor } from './publish-target.ts';

export interface PublishFieldsProps {
  readonly bump: VersionBump;
  /** Why `minor` is not a choice, when it is not: the first version of a document is a major one, and so is a copy of a version of another major. */
  readonly forced: ForcedMajor | undefined;
  readonly rationale: string;
  readonly rationaleInvalid: boolean;
  readonly onBump: (bump: VersionBump) => void;
  readonly onRationale: (text: string) => void;
}

/** The kind of change a radio group reads from its string value: the values are the two bumps, so the schema reads them as they are. */
const bumpOf = (value: string): VersionBump => publishVersionRequestSchema.shape.bump.parse(value);

/** The sentence under the choice when `minor` is off: the first version is a major one, and a copy of an earlier major is the rule `rollback_requires_major` in words. */
function explanation(forced: ForcedMajor | undefined, t: ReturnType<typeof useT>): string | undefined {
  if (forced === 'first') {
    return t('publish.bump.first');
  }
  return forced === 'rollback' ? t('documents.rule.rollback_requires_major') : undefined;
}

/**
 * The two choices of a publish (E18-S05): the kind of change, `minor` (a clarification or a typo, the signatures stay valid) or
 * `major` (everyone must sign again), forced to `major` while the document has no version or when the text is a version of another
 * major than the active one, each with its explanation; and the rationale (1 to 2000 characters),
 * which contributors read when they are asked to sign. A rationale the server's cleaning refuses is marked on the field.
 */
export function PublishFields({ bump, forced, rationale, rationaleInvalid, onBump, onRationale }: PublishFieldsProps) {
  const t = useT();
  return (
    <>
      <Field label={t('publish.bump')} description={explanation(forced, t)} required>
        <RadioGroup
          value={bump}
          onValueChange={(value) => {
            onBump(bumpOf(value));
          }}
          options={[
            { value: 'minor', label: t('publish.bump.minor'), disabled: forced !== undefined },
            { value: 'major', label: t('publish.bump.major') },
          ]}
        />
      </Field>
      <Field
        label={t('publish.rationale')}
        description={t('publish.rationaleHelp')}
        required
        error={rationaleInvalid ? t('documents.rule.invalid_rationale') : undefined}
      >
        <Textarea
          value={rationale}
          rows={4}
          onChange={(event) => {
            onRationale(event.target.value);
          }}
        />
      </Field>
    </>
  );
}
