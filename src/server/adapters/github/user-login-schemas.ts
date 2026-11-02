// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import { z } from 'zod';
import { githubIdSchema } from '../../../shared/github-id.ts';
import { avatarOrNull, cutName, LOGIN_PATTERN } from '../../domain/github-profile.ts';

// What the login reads from GitHub (E10-S05), parsed before anything leaves the adapter. A body that fails these is
// `bad_request`, and a failure names where, never the body.

/** What an access token looks like on the wire (RFC 6750 `b64token`): it goes into a header, so no space or line break. */
const ACCESS_TOKEN = /^[A-Za-z0-9\-._~+/]{1,1024}=*$/;

/**
 * The answer of the token endpoint. The refresh-token fields of an App with expiring tokens are parsed so that a
 * surprising type is noticed, and then dropped: the adapter returns the access token alone, because nothing refreshes it.
 */
export const tokenSchema = z
  .object({
    access_token: z.string().regex(ACCESS_TOKEN),
    token_type: z.string().optional(),
    scope: z.string().optional(),
    expires_in: z.number().optional(),
    refresh_token: z.string().optional(),
    refresh_token_expires_in: z.number().optional(),
  })
  .transform((body) => body.access_token);

/** An error answer: GitHub's token endpoint says `200` with `{ "error": "bad_verification_code" }`. */
export const tokenErrorSchema = z.looseObject({ error: z.string() });

/** The part of `GET /user` that decides whether the rest is read at all: a bot, an organisation or an enterprise is refused first. */
export const accountTypeSchema = z.looseObject({ type: z.string() });

/**
 * A Postgres `text` value cannot hold a NUL character, so a name with one is not stored; GitHub does not allow it in a
 * name, so this is a hostile or broken answer.
 */
const noNul = (text: string): boolean => !text.includes('\0');

/** `GET /user` for an account of type `User`: the numeric id, a login of GitHub's own shape, a name cut to 255, an avatar on GitHub's host. */
export const userSchema = z
  .looseObject({
    id: githubIdSchema,
    login: z.string().regex(LOGIN_PATTERN),
    name: z.string().refine(noNul).nullish(),
    avatar_url: z.string().nullish(),
  })
  .transform((user) => ({
    githubId: user.id,
    login: user.login,
    name: user.name === null || user.name === undefined ? null : cutName(user.name),
    avatarUrl: avatarOrNull(user.avatar_url ?? null),
  }));

/** `GET /user/emails`: every address with its flags; the verified ones are kept by the caller (`verifiedOnly`). */
export const emailsSchema = z.array(
  z.looseObject({ email: z.string().min(1).max(320), primary: z.boolean(), verified: z.boolean() }),
);
