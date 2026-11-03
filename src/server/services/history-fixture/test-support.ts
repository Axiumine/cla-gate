// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { StoredActiveVersion } from '../cla-document-types.ts';
import type { PublishWorld } from '../publish-fixture/test-support.ts';

// The helpers of the tests of the history of a document (E12-S05), on top of the world of the publish tests.

/** A logger that keeps what it is told: the error lines as `[fields, message]`, for the tests that look at the log or at its silence. */
export function recordingLog() {
  const logged: [object, string][] = [];
  return {
    logged,
    log: {
      error: (fields: object, message: string) => {
        logged.push([fields, message]);
      },
    },
  };
}

/**
 * Stores a signature of the installation-wide document of tenant 1 on exactly `version`, by a new person with this GitHub id,
 * past the routes. The signature core carries the version, its document, its major and its hash in one composite foreign key.
 */
export async function signVersion(world: PublishWorld, version: StoredActiveVersion, githubId: number): Promise<void> {
  const user = await world.db
    .insertInto('users')
    .values({ github_id: githubId, login: `login-${githubId}`, name: null, avatar_url: null })
    .returning('id')
    .executeTakeFirstOrThrow();
  await world.db
    .insertInto('signatures')
    .values({
      installation_id: world.scope.installationId,
      user_id: user.id,
      document_id: world.wide,
      version_id: version.id,
      major: version.major,
      content_sha256: version.contentSha256,
      consent_text_id: 'consent-v1',
      signer_type: 'individual',
    })
    .execute();
}
