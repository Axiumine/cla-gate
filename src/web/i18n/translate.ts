// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { interpolate, type MessageValue } from './interpolate.ts';

/** A message catalog: dotted keys and their texts. */
export type Catalog = Readonly<Record<string, string>>;

/** The names of the `{name}` placeholders in a message literal, as a union: `'Hi {a}, {b}'` gives `'a' | 'b'`. */
type PlaceholderNames<Message extends string> = Message extends `${string}{${infer Name}}${infer Rest}`
  ? Name | PlaceholderNames<Rest>
  : never;

/** The parameter object a message needs: one entry per placeholder, no more and no fewer. */
type MessageParams<Message extends string> = Readonly<Record<PlaceholderNames<Message>, MessageValue>>;

/** The rest of the arguments of `t`: the parameter object when the message has placeholders, nothing when it has none. */
type ParamArgs<Message extends string> = [PlaceholderNames<Message>] extends [never]
  ? []
  : [params: MessageParams<Message>];

/** The text of `Key` in `C`, or never when there is no such key. */
type Text<C extends Catalog, Key extends string> = Key extends keyof C ? C[Key] : never;

/** The keys `<base>.one` that have a `<base>.other` next to them: what `t.plural` can pick between. */
type PluralBase<C extends Catalog> = {
  [Key in keyof C & string]: Key extends `${infer Base}.one` ? (`${Base}.other` extends keyof C ? Base : never) : never;
}[keyof C & string];

/** The placeholders of a plural besides `count`, which `t.plural` fills in from its second argument. */
type PluralParams<C extends Catalog, Base extends string> = MessageParams<
  Text<C, `${Base}.one`> | Text<C, `${Base}.other`>
>;
type OtherNames<C extends Catalog, Base extends string> = Exclude<keyof PluralParams<C, Base>, 'count'>;
type PluralArgs<C extends Catalog, Base extends string> = [OtherNames<C, Base>] extends [never]
  ? []
  : [params: Readonly<Record<OtherNames<C, Base>, MessageValue>>];

/** `t` and its plural form for one catalog. */
export interface Translate<C extends Catalog> {
  /** The message under `key`, its `{name}` placeholders replaced. Parameters are required exactly when there are placeholders. */
  <Key extends keyof C & string>(key: Key, ...params: ParamArgs<C[Key]>): string;
  /** `<key>.one` when `count` is one in this language and `<key>.other` otherwise; `{count}` is `count` written for the locale. */
  plural<Base extends PluralBase<C>>(key: Base, count: number, ...params: PluralArgs<C, Base>): string;
}

/** Builds `t` for `catalog` in `locale`. The catalog keeps its literal type, so a wrong key or parameter fails `tsc`. */
export function createTranslator<const C extends Catalog>(catalog: C, locale: string): Translate<C> {
  const texts = new Map(Object.entries(catalog));
  /** The text under `key`; a key the types would have refused shows as itself, so a bug is visible and not a blank. */
  const text = (key: string): string => texts.get(key) ?? key;
  const rules = new Intl.PluralRules(locale);
  const numbers = new Intl.NumberFormat(locale);

  function t<Key extends keyof C & string>(key: Key, ...params: ParamArgs<C[Key]>): string;
  function t(key: string, params?: Readonly<Record<string, MessageValue>>): string {
    return interpolate(text(key), params ?? {});
  }

  function plural<Base extends PluralBase<C>>(key: Base, count: number, ...params: PluralArgs<C, Base>): string;
  function plural(key: string, count: number, params?: Readonly<Record<string, MessageValue>>): string {
    const category = rules.select(count) === 'one' ? 'one' : 'other';
    return interpolate(text(`${key}.${category}`), { ...params, count: numbers.format(count) });
  }

  return Object.assign(t, { plural });
}
