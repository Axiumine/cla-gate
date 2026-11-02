// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { z } from 'zod';
import {
  type Eligibility,
  evaluationEligibility,
  INELIGIBLE_REASONS,
  type InstallationState,
  type RepositoryState,
} from './eligibility.ts';

// The five things that can stop an evaluation, as the names a row of the table below lists. The domain never reads a
// timestamp, so any object stands for "set".
const WHEN = { at: 'some time' };

type Flag = 'rejected' | 'deleted' | 'suspended' | 'removed' | 'disabled';

const FLAGS: readonly Flag[] = ['rejected', 'deleted', 'suspended', 'removed', 'disabled'];

/** Hands the function a value the types forbid, as a row from an unmigrated database or plain JavaScript would. */
const installationOf = (value: unknown): InstallationState => z.custom<InstallationState>().parse(value);
const repositoryOf = (value: unknown): RepositoryState => z.custom<RepositoryState>().parse(value);

function facts(raised: readonly Flag[]): { installation: InstallationState; repository: RepositoryState } {
  return {
    installation: {
      admissionStatus: raised.includes('rejected') ? 'rejected' : 'admitted',
      deletedAt: raised.includes('deleted') ? WHEN : null,
      suspendedAt: raised.includes('suspended') ? WHEN : null,
    },
    repository: { removedAt: raised.includes('removed') ? WHEN : null, enabled: !raised.includes('disabled') },
  };
}

const ELIGIBLE: Eligibility = { eligible: true };
const no = (reason: (typeof INELIGIBLE_REASONS)[number]): Eligibility => ({ eligible: false, reason });

// Every combination of the five flags, written out: the first flag raised, in the order of INELIGIBLE_REASONS, wins.
// Each key lists the raised flags in that order.
const TABLE: Readonly<Record<string, Eligibility>> = {
  '': ELIGIBLE,
  disabled: no('repository_disabled'),
  removed: no('repository_removed'),
  'removed disabled': no('repository_removed'),
  suspended: no('installation_suspended'),
  'suspended disabled': no('installation_suspended'),
  'suspended removed': no('installation_suspended'),
  'suspended removed disabled': no('installation_suspended'),
  deleted: no('installation_deleted'),
  'deleted disabled': no('installation_deleted'),
  'deleted removed': no('installation_deleted'),
  'deleted removed disabled': no('installation_deleted'),
  'deleted suspended': no('installation_deleted'),
  'deleted suspended disabled': no('installation_deleted'),
  'deleted suspended removed': no('installation_deleted'),
  'deleted suspended removed disabled': no('installation_deleted'),
  rejected: no('installation_rejected'),
  'rejected disabled': no('installation_rejected'),
  'rejected removed': no('installation_rejected'),
  'rejected removed disabled': no('installation_rejected'),
  'rejected suspended': no('installation_rejected'),
  'rejected suspended disabled': no('installation_rejected'),
  'rejected suspended removed': no('installation_rejected'),
  'rejected suspended removed disabled': no('installation_rejected'),
  'rejected deleted': no('installation_rejected'),
  'rejected deleted disabled': no('installation_rejected'),
  'rejected deleted removed': no('installation_rejected'),
  'rejected deleted removed disabled': no('installation_rejected'),
  'rejected deleted suspended': no('installation_rejected'),
  'rejected deleted suspended disabled': no('installation_rejected'),
  'rejected deleted suspended removed': no('installation_rejected'),
  'rejected deleted suspended removed disabled': no('installation_rejected'),
};

test('the table has one row for each of the 32 combinations of the five flags', () => {
  const keys = Array.from({ length: 2 ** FLAGS.length }, (_, mask) =>
    FLAGS.filter((_flag, index) => (mask >> index) & 1).join(' '),
  );
  expect(new Set(keys).size).toBe(32);
  expect(Object.keys(TABLE).toSorted((a, b) => a.localeCompare(b))).toEqual(
    keys.toSorted((a, b) => a.localeCompare(b)),
  );
});

test.each(Object.entries(TABLE))('with [%s] raised the answer is %j', (raised, expected) => {
  const flags = FLAGS.filter((flag) => raised.split(' ').includes(flag));
  const { installation, repository } = facts(flags);
  expect(evaluationEligibility(installation, repository)).toEqual(expected);
});

test('the reasons are exactly the five of the story, in the order they are checked', () => {
  expect(INELIGIBLE_REASONS).toEqual([
    'installation_rejected',
    'installation_deleted',
    'installation_suspended',
    'repository_removed',
    'repository_disabled',
  ]);
});

test('a status that is not one of the known values is refused, never served', () => {
  const unknownStatus = installationOf({ admissionStatus: 'pending', deletedAt: null, suspendedAt: null });
  expect(evaluationEligibility(unknownStatus, facts([]).repository)).toEqual(no('installation_rejected'));
});

test('a missing timestamp or flag counts as raised, so an incomplete row fails closed', () => {
  const noTimestamps = installationOf({ admissionStatus: 'admitted' });
  const noRemovedAt = repositoryOf({ enabled: true });
  const noEnabled = repositoryOf({ removedAt: null });
  expect(evaluationEligibility(noTimestamps, facts([]).repository)).toEqual(no('installation_deleted'));
  expect(evaluationEligibility(facts([]).installation, noRemovedAt)).toEqual(no('repository_removed'));
  expect(evaluationEligibility(facts([]).installation, noEnabled)).toEqual(no('repository_disabled'));
});
