# Upgrade

An upgrade is a new checkout, a rebuilt image and the migrations that come with it. Migrations only go forward: there is no way back except the backup you take first, so the first step is not optional.

## Steps

1. Read what changed. Releases are tags named `v<version>`; the release notes are `CHANGELOG.md` at the version you are going to, and the same text is on the Releases page of the repository `SOURCE_URL` points at. Look for new settings, new migrations and anything marked as breaking:

   ```sh
   git fetch --tags
   git show v1.2.0:CHANGELOG.md | head -80
   git diff HEAD v1.2.0 -- .env.example
   ```

   The last command shows the settings that are new or changed. Between releases `[Unreleased]` in the same file lists what is on the main branch, and `git log --oneline HEAD..origin/main` the commits.

2. Take a backup and check that it can be read ([backup-restore.md](backup-restore.md)): run the daily script now, and keep that dump until you have checked the new version.

3. Check out the new version. The tracked files, `migrations/` above all, must be unchanged on your side: `git status` shows nothing but untracked files (`.env`, `secrets/`, an override file are ignored or yours).

   ```sh
   git checkout v1.2.0
   sh scripts/init-secrets.sh
   ```

   `init-secrets.sh` creates only what is missing, so running it again is how a new version's new secret file (if it has one) appears; it never changes a file you have. Add any new setting from the diff of step 1 to `.env`.

4. Rebuild and restart. Use the command of your installation ([install.md](install.md)), with `--build`:

   ```sh
   SOURCE_COMMIT=$(git rev-parse HEAD) docker compose --profile tls up --build -d
   ```

   Compose builds the image from the checkout, then runs `migrate` to completion, and only then re-creates `app`, so the new server never starts on an old schema. `app` is down for the seconds that its re-creation takes; a webhook delivery that arrives meanwhile fails, and the periodic sweep (every 30 minutes by default) re-checks open pull requests that missed an event. You can also redeliver from the App's Advanced tab on GitHub.

5. Watch `migrate` run:

   ```sh
   docker compose logs migrate
   ```

   A successful run prints `migrations applied: <names>` or `migrations: up to date`, then `job queues: up to date` (or `job queues created` / `updated` followed by the names). Every migration runs in its own transaction, so one that fails leaves the database as it was before it.

6. Check the result:

   ```sh
   docker compose --profile tls ps -a
   curl -fsS https://cla.example.com/readyz
   curl -fsS https://cla.example.com/api/meta
   ```

   `migrate` is `exited (0)`, `app` is `healthy`, `/readyz` is `{"status":"ready"}`, and the `commit` of `/api/meta` is `git rev-parse HEAD`. Remove old images when you are satisfied: `docker image prune`.

The PostgreSQL major version is pinned by the image tag in `docker-compose.yml`. An upgrade of the platform does not change it, and you must not change it by editing the tag: the data directory of one major version cannot be opened by another. Moving to a new major version is a dump and a restore ([backup-restore.md](backup-restore.md)).

## Migrations are forward-only and checksummed

`migrations/` holds numbered SQL files. `migrate` applies the ones the database has not seen, in order, and records each with a checksum of its content in the table `schema_migrations`. It refuses to run when the history and the files disagree: an applied migration that was edited, or is missing, or a new one that sorts before one already applied. There are no down migrations. A migration that was released is never edited; a mistake is corrected by a newer migration.

**A downgrade is a restore.** A database that has applied a newer migration cannot be used by an older checkout (the older one does not have the file, and `migrate` refuses). To go back, restore the dump you took before the upgrade into a freshly provisioned database together with the older checkout:

```sh
git checkout v1.1.0
docker compose --profile tls down
docker volume rm cla-gate_cla-postgres-data
docker compose up -d --wait postgres
docker compose exec -T postgres pg_restore -U postgres -d cla --no-owner --role=cla_owner --clean --if-exists --exit-on-error < cla.dump
SOURCE_COMMIT=$(git rev-parse HEAD) docker compose up --build -d
```

Everything signed or changed after that dump is lost with it. If the upgrade did not work out within the hour, that is a small price; the longer you wait, the more you lose, so decide early.

## When `migrate` refuses

`app` does not start while `migrate` has failed, so the stack is stopped, not broken. The message is on the line that starts with `migration failed:`. Read it with `docker compose logs migrate`.

| Message | Cause | What to do |
|---|---|---|
| `applied migration <name> was edited after it was applied (checksum mismatch)` | A file in `migrations/` differs from the one the database applied: a local edit, a merge, a different branch | `git status` and `git diff migrations/`. Put the file back with `git checkout -- migrations/`, or check out the commit the database was migrated with. Never edit a migration to make this go away |
| `applied migration <name> is missing from the migrations directory` | The checkout is older than the database (a downgrade), or a file was deleted | Check out the newer version again. For a deliberate downgrade, restore as shown above |
| `pending migration <name> is older than the applied migration <newest>` | A migration you added (a fork) has a lower number than one that is applied | Renumber the new file so that it sorts after the newest applied one. It has not run yet, so it can be renamed |
| `invalid migration file name` or `two migrations share the number` | A file in `migrations/` does not follow `NNN_snake_case.sql`, or two share a number | Rename it. Compare with a clean checkout |
| `password authentication failed for user "cla_owner"` or `ECONNREFUSED` | `secrets/migration_database_url` holds a password the database does not have, or the database is not up | Compare the password in `secrets/migration_database_url` with `secrets/db_owner_password`. If you changed a password file after the first start, the role still has the old one: set it with [key-rotation.md](key-rotation.md#database-role-passwords-database_url-migration_database_url). `docker compose ps` shows whether `postgres` is `healthy` |
| `permission denied for schema public`, `must be owner of ...` | `migration_database_url` names a role other than the owner, usually `cla_app` | It must be `cla_owner`. The runtime role owns nothing and can create nothing, on purpose |
| `Job queues have the wrong policy: ...` | A queue exists with another policy than the code needs (pg-boss cannot change it) | Stop the app (`docker compose stop app`), delete the named queue, and run `docker compose run --rm migrate` again, as [`../operations.md`](../operations.md) describes. Its jobs go with it |

A different problem shows up after `migrate` succeeded: `permission denied for table <name>` in the log of `app`. The runtime role has no grant on a table. The migrations grant to `cla_app` only if that role exists when they run, which it always does when `postgres` provisioned the database. If you moved the data to a database that was migrated before `cla_app` existed, the grants were skipped. Restore the dump into a database that was provisioned first ([backup-restore.md](backup-restore.md)).

If you are stuck, do not edit `schema_migrations` by hand. Restore the pre-upgrade backup, stay on the old version, and report the message you got.
