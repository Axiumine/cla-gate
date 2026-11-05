// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { FieldErrors, Resolver } from 'react-hook-form';
import { z } from 'zod';
import type { SignRequest } from '../../shared/sign.ts';
import type { SignContextResponse } from '../../shared/sign-context.ts';
import { SIGNER_RULE_STATUS, type SignerRule, signerInputSchema } from '../../shared/signer-input.ts';
import { ApiError } from '../api/index.ts';

// What the consent form of the sign page holds and checks (E18-S01). The name is checked with the schema the server checks it
// with (`signerInputSchema`, E13-S03), so the browser and the server agree on what a name is; the rest is the shape of the
// form: the consent is given, and one verified address is chosen.

/** The values of the form as the controls hold them. */
export interface ConsentFormValues {
  /** The box beside the consent sentence. */
  consent: boolean;
  /** The name as typed. */
  name: string;
  /** The address chosen from the verified list; empty while none is chosen. */
  email: string;
}

/** The form: the consent is `true`, the name passes the shared rules, and an address is chosen. */
const consentFormSchema = z.object({
  consent: z.literal(true),
  name: signerInputSchema.shape.name,
  email: z.string().min(1),
});

/** Which fields of the form the issues of a failed check are on. */
function errorsOf(error: z.ZodError): FieldErrors<ConsentFormValues> {
  const failed = new Set(error.issues.map((issue) => issue.path[0]));
  return {
    ...(failed.has('consent') ? { consent: { type: 'required' } } : {}),
    ...(failed.has('name') ? { name: { type: 'invalid_name' } } : {}),
    ...(failed.has('email') ? { email: { type: 'required' } } : {}),
  };
}

/** The resolver of React Hook Form for {@link consentFormSchema}: a field is wrong when the schema has an issue on it. */
export const consentResolver: Resolver<ConsentFormValues> = (values) => {
  const result = consentFormSchema.safeParse(values);
  return result.success ? { values, errors: {} } : { values: {}, errors: errorsOf(result.error) };
};

/** The values the form starts with: nothing agreed, no name, and the address chosen when GitHub verified exactly one. */
export function initialValues(context: SignContextResponse): ConsentFormValues {
  const [only, ...others] = context.emails;
  return { consent: false, name: '', email: only !== undefined && others.length === 0 ? only.email : '' };
}

/**
 * The body of the sign request for values that passed the check: the version and the SHA-256 of the text that was on screen,
 * the id of the consent sentence as the server sent it, and the name as the shared schema cleans it.
 */
export function buildSignRequest(context: SignContextResponse, values: ConsentFormValues): SignRequest {
  const { name, email } = consentFormSchema.parse(values);
  return {
    githubRepoId: context.repository.githubRepoId,
    ...(context.pr === null ? {} : { prNumber: context.pr }),
    versionId: context.version.id,
    contentSha256: context.version.contentSha256,
    consentTextId: context.consent.id,
    name,
    email,
  };
}

/** The field of the form that each rule of the typed name and address is about. */
const FIELD_OF_RULE = {
  invalid_name: 'name',
  email_not_verified: 'email',
  no_verified_email: 'email',
} as const satisfies Record<SignerRule, 'name' | 'email'>;

/** Whether `code` is one of the rules the server judges the typed name and address by (E13-S03). */
function isSignerRule(code: string): code is SignerRule {
  return Object.hasOwn(SIGNER_RULE_STATUS, code);
}

/** The rule an error of the sign request is about, when it is about the typed name or address; else `undefined`. */
export function signerRuleOf(error: unknown): SignerRule | undefined {
  return error instanceof ApiError && isSignerRule(error.code) ? error.code : undefined;
}

/** The field a rule is shown on. */
export function fieldOfRule(rule: SignerRule): 'name' | 'email' {
  // eslint-disable-next-line security/detect-object-injection -- rule is the closed SignerRule union, never user input
  return FIELD_OF_RULE[rule];
}
