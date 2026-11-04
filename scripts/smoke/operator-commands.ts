// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni

// E19-S12: the command lines of docs/operations/backup-restore.md that the backup scenario runs, character for character. The
// guide says its commands are the ones the scenario executes, so `operator-commands.test.ts` reads the guide and fails when a
// line here is not a line there. `Stack.shell` (compose.ts) makes `docker compose` and `git` mean this stack and its checkout, and
// runs the lines in a directory of its own, where `cla.dump` is written and read.

export const OPERATOR_COMMANDS = {
  /** The daily backup, through the running `postgres` container as the database owner. */
  dump: 'docker compose exec -T postgres pg_dump -U cla_owner -Fc cla > cla.dump',
  /** Removes the containers and the volumes of a stack that is gone or broken. */
  removeStack: 'docker compose down -v',
  /** Starts only the database: on the empty volume the provisioning script creates the roles. */
  startDatabase: 'docker compose up -d --wait postgres',
  /** The restore, into the database that was just provisioned. */
  restore:
    'docker compose exec -T postgres pg_restore -U postgres -d cla --no-owner --role=cla_owner --clean --if-exists --exit-on-error < cla.dump',
  /** Starts the rest of the stack; `migrate` finds the history in `schema_migrations`. */
  startStack: 'SOURCE_COMMIT=$(git rev-parse HEAD) docker compose up -d',
  /** The first command of "Check the result". */
  countMigrations:
    'docker compose exec -T postgres psql -U cla_owner -d cla -Atc "select count(*) from schema_migrations"',
  /** The third command of "Check the result": the triggers that make CLA versions immutable. */
  versionTriggers:
    'docker compose exec -T postgres psql -U cla_owner -d cla -Atc "select tgname from pg_trigger where tgrelid = \'cla_versions\'::regclass and not tgisinternal"',
} as const;
