// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { type AriaAttributes, createContext, useContext } from 'react';

/** What a `Field` tells the control inside it (E17-S06): the ids that tie label, description and error to it. */
export interface FieldState {
  /** The id of the control, which the label's `htmlFor` names. */
  readonly controlId: string;
  /** The id of the label: a group of controls (a radio group) is named by `aria-labelledby` instead of `htmlFor`. */
  readonly labelId: string;
  /** The ids of the description and the error that exist, space separated, for `aria-describedby`; absent when neither does. */
  readonly describedBy: string | undefined;
  readonly invalid: boolean;
  readonly required: boolean;
}

export const FieldContext = createContext<FieldState | null>(null);

/** The attributes of a control that the field owns. A control passes its own, which count when it stands outside a field. */
export interface ControlAria {
  readonly id?: string | undefined;
  readonly 'aria-describedby'?: string | undefined;
  readonly 'aria-invalid'?: AriaAttributes['aria-invalid'];
  readonly 'aria-required'?: AriaAttributes['aria-required'];
}

export interface FieldControl {
  /** Spread onto the control, after its own props. */
  readonly aria: ControlAria;
  /** The id of the label of the field the control stands in, for a group that `aria-labelledby` names. */
  readonly labelId: string | undefined;
}

/** The words of `ids` that are there, joined by a space; undefined when none is. */
function joinIds(...ids: readonly (string | undefined)[]): string | undefined {
  const present = ids.filter((id) => id !== undefined && id !== '');
  return present.length === 0 ? undefined : present.join(' ');
}

/**
 * The accessibility attributes of a control: inside a `Field` its id, its description and error, `aria-invalid` and
 * `aria-required` come from the field, so the label and the control cannot drift apart (the field's id wins over the
 * control's own, which the label's `htmlFor` could not follow). Outside a field the control's own props are used as given.
 */
export function useFieldControl(own: ControlAria): FieldControl {
  const field = useContext(FieldContext);
  return {
    aria: {
      id: field?.controlId ?? own.id,
      'aria-describedby': joinIds(own['aria-describedby'], field?.describedBy),
      'aria-invalid': field?.invalid === true ? true : own['aria-invalid'],
      'aria-required': field?.required === true ? true : own['aria-required'],
    },
    labelId: field?.labelId,
  };
}
