// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { expect, test } from 'vitest';
import { errorResponseSchema } from '../../../shared/errors.ts';
import {
  convertWorld,
  issueManifestState,
  postConvert,
  refusal,
  SECOND_CODE,
} from './setup-convert-fixture/test-support.ts';

// E19-S11: the credentials are handed out once, also when two conversions arrive together. A browser that posts the manifest
// form to GitHub twice has two Apps, two one-time codes and one `state`, and both callbacks may convert at the same moment;
// the `state` is taken before GitHub is asked, so only one of them gets to ask.

/** The conversion with `code` and `state`, as the page of a second tab would send it. */
const withCode = (code: string, state: string) => ({ body: { code, state } });

test('two conversions at once with one state: one gets the credentials, the other is setup_code_invalid, and GitHub is asked once', async () => {
  const { app, unlocked, github, sessions } = await convertWorld();
  const state = await issueManifestState(app, unlocked);
  const { release } = github.holdNext();
  const first = postConvert(app, unlocked, state);
  const second = postConvert(app, unlocked, state, withCode(SECOND_CODE, state));
  // The one that does not wait for GitHub answers first.
  const answeredAlone = await Promise.race([first, second]);
  expect(answeredAlone.statusCode).toBe(400);
  expect(errorResponseSchema.parse(answeredAlone.json()).error.code).toBe('setup_code_invalid');
  release();
  const answers = await Promise.all([first, second]);
  expect(answers.map((answer) => answer.statusCode).toSorted((a, b) => a - b)).toEqual([200, 400]);
  expect(github.requests).toHaveLength(1);
  expect(github.converted).toHaveLength(1);
  expect(sessions.credentialsIssued).toBe(true);
});

test('a conversion that is under way and ends in an outage gives the state back, and the retry then works', async () => {
  const { app, unlocked, github, stateOf } = await convertWorld();
  const state = await issueManifestState(app, unlocked);
  github.answerNext(() => Response.json({ message: 'down' }, { status: 503 }));
  const { arrived, release } = github.holdNext();
  const underWay = postConvert(app, unlocked, state);
  await arrived;
  expect(await refusal(postConvert(app, unlocked, state, withCode(SECOND_CODE, state)))).toEqual([
    400,
    'setup_code_invalid',
  ]);
  expect(stateOf()).toBeUndefined();
  release();
  expect((await underWay).statusCode).toBe(502);
  expect(stateOf()).toBe(state);
  expect((await postConvert(app, unlocked, state)).statusCode).toBe(200);
});

test('an outage does not bring back a state that a newer manifest replaced meanwhile', async () => {
  const { app, unlocked, github, stateOf } = await convertWorld();
  const old = await issueManifestState(app, unlocked);
  github.answerNext(() => Response.json({ message: 'down' }, { status: 503 }));
  const { arrived, release } = github.holdNext();
  const underWay = postConvert(app, unlocked, old);
  await arrived;
  const newer = await issueManifestState(app, unlocked);
  release();
  expect((await underWay).statusCode).toBe(502);
  expect(stateOf()).toBe(newer);
  expect(await refusal(postConvert(app, unlocked, old))).toEqual([400, 'setup_code_invalid']);
  expect((await postConvert(app, unlocked, newer)).statusCode).toBe(200);
});

test('a verdict of GitHub that is not an outage keeps the state used up, a retry included', async () => {
  const { app, unlocked, github, stateOf } = await convertWorld();
  const state = await issueManifestState(app, unlocked);
  github.answerNext(() => Response.json({ message: 'Not Found' }, { status: 404 }));
  const { release } = github.holdNext();
  const underWay = postConvert(app, unlocked, state);
  release();
  expect((await underWay).statusCode).toBe(400);
  expect(stateOf()).toBeUndefined();
  expect(await refusal(postConvert(app, unlocked, state))).toEqual([400, 'setup_code_invalid']);
  expect(github.requests).toHaveLength(1);
});
