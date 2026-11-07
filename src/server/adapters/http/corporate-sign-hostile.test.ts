// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { HOSTILE_CONTROL_NAMES, HOSTILE_NAMES } from '../../../shared/hostile-names.ts';
import {
  bodyFor,
  corporateWorld,
  createdOf,
  detailsOf,
  failureOf,
  NOTHING_WRITTEN,
  postAgreement,
  signerWith,
  watchRows,
} from './corporate-fixture/test-support.ts';

// Hostile text in a corporate signing (E21-S02): the company name and the title are kept as typed apart from the cleaning of the
// form, in `corporate_agreement_pii` and nowhere else; neutralising them is the job of each output. What a person may not type
// (control characters, line and paragraph separators, bidirectional overrides, a lone surrogate, too many characters, nothing) is
// a 422 `validation_failed` that names the field and holds none of the text.

/** U+202E, the right-to-left override. */
const RLO = String.fromCodePoint(0x202e);

/** The names of the corpus that fit the title (100 code points). */
const TITLES = HOSTILE_NAMES.filter((name) => Array.from(name).length <= 100);

/** What the cleaning of the form makes of a printable name. */
const cleaned = (name: string): string => name.normalize('NFC').trim().replaceAll(/\s+/gu, ' ');

/** Whether `text` holds `name`, raw or as JSON escapes it. */
const holds = (text: string, name: string): boolean =>
  text.includes(name) || text.includes(JSON.stringify(name).slice(1, -1));

test('every name of the corpus is accepted as a company name, stored byte for byte in corporate_agreement_pii and found nowhere else', async () => {
  const world = await corporateWorld();
  for (const [index, name] of HOSTILE_NAMES.entries()) {
    const who = await signerWith(world, 5000 + index);
    const { id } = createdOf(await postAgreement(world, who, bodyFor(world.c1, { companyName: name })));
    const stored = await world.db
      .selectFrom('corporate_agreement_pii')
      .select('company_name')
      .where('agreement_id', '=', id)
      .executeTakeFirstOrThrow();
    expect(stored.company_name, `entry ${index}`).toBe(cleaned(name));
    expect(Buffer.from(stored.company_name).equals(Buffer.from(cleaned(name))), `entry ${index}`).toBe(true);
  }
  const elsewhere = JSON.stringify([
    await world.db.selectFrom('signatures').selectAll().execute(),
    await world.db.selectFrom('signer_pii').selectAll().execute(),
    await world.db.selectFrom('corporate_agreements').selectAll().execute(),
    await world.db.selectFrom('corporate_approvals').selectAll().execute(),
    await world.db.selectFrom('audit_log').selectAll().execute(),
  ]);
  expect(HOSTILE_NAMES.filter((name) => holds(elsewhere, name))).toEqual([]);
});

test('every name of the corpus that fits is accepted as a title and stored byte for byte', async () => {
  const world = await corporateWorld();
  expect(TITLES.length).toBeGreaterThan(20);
  for (const [index, name] of TITLES.entries()) {
    const who = await signerWith(world, 6000 + index);
    const { id } = createdOf(await postAgreement(world, who, bodyFor(world.c1, { signatoryTitle: name })));
    const stored = await world.db
      .selectFrom('corporate_agreement_pii')
      .select('signatory_title')
      .where('agreement_id', '=', id)
      .executeTakeFirstOrThrow();
    expect(stored.signatory_title, `entry ${index}`).toBe(cleaned(name));
  }
});

test.each(['companyName', 'signatoryTitle'] as const)(
  'every text a person may not type as the %s is a 422 validation_failed naming the field, and writes nothing',
  async (field) => {
    const world = await corporateWorld();
    const written = await watchRows(world.db);
    const forbidden = [...HOSTILE_CONTROL_NAMES, 'tab\there', '', '   ', RLO, '\u2066isolate'];
    for (const [index, text] of forbidden.entries()) {
      const who = await signerWith(world, 7000 + index);
      const response = await postAgreement(world, who, bodyFor(world.c1, { [field]: text }));
      expect(failureOf(response), `entry ${index}`).toEqual([422, 'validation_failed']);
      expect(detailsOf(response), `entry ${index}`).toEqual({ field });
      expect(response.body, `entry ${index}`).not.toContain('onerror');
    }
    expect(await written()).toEqual(NOTHING_WRITTEN);
  },
);

test.each([
  ['companyName', 200, 201],
  ['signatoryTitle', 100, 101],
] as const)('the %s may have %i code points and not %i', async (field, most, over) => {
  const world = await corporateWorld();
  const ok = await postAgreement(world, world.ada, bodyFor(world.c1, { [field]: 'x'.repeat(most) }));
  expect(ok.statusCode).toBe(201);
  const eve = await signerWith(world, 4321);
  const tooLong = await postAgreement(world, eve, bodyFor(world.c1, { [field]: 'x'.repeat(over) }));
  expect(failureOf(tooLong)).toEqual([422, 'validation_failed']);
  expect(detailsOf(tooLong)).toEqual({ field });
});

test('the limits count code points and not UTF-16 units: 200 emoji are a company name and 100 are a title', async () => {
  const world = await corporateWorld();
  const emoji = '\u{1f600}';
  const answer = await postAgreement(
    world,
    world.ada,
    bodyFor(world.c1, { companyName: emoji.repeat(200), signatoryTitle: emoji.repeat(100) }),
  );
  expect(answer.statusCode).toBe(201);
});

test('the hostile company name of the story is stored as text and the answer to a signing holds none of it', async () => {
  const world = await corporateWorld();
  const response = await postAgreement(
    world,
    world.ada,
    bodyFor(world.c1, {
      companyName: '<img src=x onerror=alert(1)>',
      signatoryTitle: '=HYPERLINK("http://evil.example","x")',
    }),
  );
  const { id } = createdOf(response);
  expect(response.body).not.toContain('onerror');
  expect(response.body).not.toContain('HYPERLINK');
  expect(
    await world.db
      .selectFrom('corporate_agreement_pii')
      .select(['company_name', 'signatory_title'])
      .where('agreement_id', '=', id)
      .execute(),
  ).toEqual([
    { company_name: '<img src=x onerror=alert(1)>', signatory_title: '=HYPERLINK("http://evil.example","x")' },
  ]);
});
