// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { type ComponentPropsWithoutRef, type ReactNode, useId } from 'react';
import { classNames } from './class-names.ts';
import { useFieldControl } from './field-context.ts';

export interface RadioOption {
  readonly value: string;
  /** The visible label: text from the catalog, or user text through `UserText`. */
  readonly label: ReactNode;
  readonly disabled?: boolean;
}

type RootProps = ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>;

export type RadioGroupProps = Omit<RootProps, 'children'> & { readonly options: readonly RadioOption[] };

/** One option: the radio and the label that names it and also selects it when clicked. */
function RadioOptionRow({ option }: { readonly option: RadioOption }) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <RadioGroupPrimitive.Item
        id={id}
        value={option.value}
        disabled={option.disabled}
        className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full border border-line bg-surface data-[state=checked]:border-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        <RadioGroupPrimitive.Indicator className="size-2.5 rounded-full bg-accent" />
      </RadioGroupPrimitive.Item>
      <label htmlFor={id} className="text-fg">
        {option.label}
      </label>
    </div>
  );
}

/**
 * A group of radio buttons on Radix's (E17-S06): one tab stop for the group, arrow keys move and select, Space selects.
 * Inside a `Field` the field's label names the group (`aria-labelledby`); standing alone it needs an `aria-label`.
 */
export function RadioGroup({ options, className, ...props }: RadioGroupProps) {
  const { aria, labelId } = useFieldControl(props);
  return (
    <RadioGroupPrimitive.Root
      {...props}
      {...aria}
      aria-labelledby={props['aria-labelledby'] ?? labelId}
      className={classNames('flex flex-col gap-2', className)}
    >
      {options.map((option) => (
        <RadioOptionRow key={option.value} option={option} />
      ))}
    </RadioGroupPrimitive.Root>
  );
}
