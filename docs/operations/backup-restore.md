# Backup and restore

Signatures are legal evidence: the record that a person agreed to a CLA version at a given time is what the platform exists to keep, and the database is the only place it lives. Back it up every day, copy the backups off the server, and rehearse the restore before you need it. The backup and restore commands below are the ones the backup scenario of the container smoke test (E19-S12) is to run, so the two must stay equal: a change to one changes the other in the same pull request.

## What to back up

| What | How | Notes |
|---|---|---|
| The database `cla` | `pg_dump -Fc`, daily | Everything: signatures, CLA versions, the audit log, personal data, sessions and the job queue. This is the backup that matters |
| `secrets/` and `.env` | A copy in your secret manager, kept apart from the dumps | A dump holds no password, and roles are not part of it. You can regenerate every secret (the GitHub credentials in the App's settings), but losing the files costs time. A dump and the secrets that open it should not sit in one place |
| The volume `caddy-data` | Optional | Only the certificate and Caddy's account key. Both can be issued again, but Let's Encrypt limits how often ([reverse-proxy.md](reverse-proxy.md)) |

A dump contains personal data (names, emails, logins) and the whole evidence. Encrypt it (for example with `age` or `gpg`) before it leaves the server, keep it to the people who may read the database, and bound how long you keep it ([data-protection.md](data-protection.md) says why).

## The daily backup

The command, through the running `postgres` container as the database owner:

```sh
docker compose exec -T postgres pg_dump -U cla_owner -Fc cla > cla.dump
```

`-T` is required: without it Docker allocates a terminal and corrupts the binary output. The connection is a local socket inside the container, which needs no password. `-Fc` is the compressed custom format, the one `pg_restore` reads.

A script that writes the file under a temporary name, checks that it can be read and only then gives it its final name, so a failed run never leaves something that looks like a backup:

```sh
#!/bin/sh
# /usr/local/bin/cla-backup: one dump a day, kept 14 days. Run from cron as a user who may use Docker.
set -eu
umask 077
cd /srv/cla-gate
directory=/var/backups/cla-gate
day=$(date +%Y-%m-%d)
mkdir -p "$directory"
docker compose exec -T postgres pg_dump -U cla_owner -Fc cla > "$directory/cla-$day.dump.partial"
docker compose exec -T postgres pg_restore --list < "$directory/cla-$day.dump.partial" > /dev/null
mv "$directory/cla-$day.dump.partial" "$directory/cla-$day.dump"
find "$directory" -name 'cla-*.dump' -mtime +14 -delete
```

and the cron entry `17 3 * * * /usr/local/bin/cla-backup`. Make the script alert you when it fails (cron mails its output, or wrap it in your monitoring), copy `$directory` off the server, and decide how many days to keep. Fourteen is an example.

## Point-in-time recovery (optional)

A daily dump loses up to a day of signatures if the disk dies at the wrong moment. To lose minutes instead, have PostgreSQL archive its write-ahead log and take a base backup now and then. This is PostgreSQL's own feature; the stack only needs two settings and a directory.

Create a directory the database user (uid 999 in the image) may write, and a file `docker-compose.override.yml` next to `docker-compose.yml`, which compose reads by itself:

```sh
sudo install -d -o 999 -g 999 -m 0700 /srv/cla-wal-archive
```

```yaml
services:
  postgres:
    command:
      - postgres
      - -c
      - archive_mode=on
      - -c
      - archive_command=test ! -f /wal-archive/%f && cp %p /wal-archive/%f
      - -c
      - archive_timeout=300
    volumes:
      - /srv/cla-wal-archive:/wal-archive
```

Run `docker compose up -d`. A segment of the log is archived when it is full, and at least every five minutes while there is activity (`archive_timeout`); the archive grows until you prune it. Copy it off the server together with the dumps. A base backup, streamed through the container, once a week:

```sh
docker compose exec -T postgres pg_basebackup -U postgres -D - -Ft -X none --checkpoint=fast | gzip > base.tar.gz
docker compose exec -T postgres psql -U postgres -c 'select pg_switch_wal()'
```

The second command makes the last segment of the backup reach the archive. The recovery itself (an empty data directory, the base backup unpacked into it, `recovery.signal`, a `restore_command` that reads the archive and a `recovery_target_time`) is described in the PostgreSQL manual, chapter "Continuous Archiving and Point-in-Time Recovery". Rehearse it on a scratch machine, because a recovery is not something to learn on the day. In this stack the cluster is in the volume `cla-postgres-data`, mounted at `/var/lib/postgresql`, and its data directory is `/var/lib/postgresql/18/docker`. A recovery brings back the roles with the passwords they had at the time of the backup, so `secrets/` must be the files of that time, or you re-run the provisioning script ([key-rotation.md](key-rotation.md#database-role-passwords-database_url-migration_database_url)).

## Restore into a fresh server

You need the dump, and `secrets/` and `.env` (or new ones; the roles are created from whichever `secrets/` is there). The restore goes into a database that was just provisioned and is empty. The command replaces everything it finds in the database it is pointed at, so never aim it at a live one.

### The compose stack

```sh
docker compose down -v
docker compose up -d --wait postgres
docker compose exec -T postgres pg_restore -U postgres -d cla --no-owner --role=cla_owner --clean --if-exists --exit-on-error < cla.dump
SOURCE_COMMIT=$(git rev-parse HEAD) docker compose up -d
```

What each line does:

1. `down -v` removes the containers and the volumes, the database and the Caddy certificates included. Run it only when you replace a stack that is gone or broken, and after you saved whatever dump you have. With the `tls` profile, give the command `--profile tls` (or set `COMPOSE_PROFILES=tls` in `.env`, as [install.md](install.md) suggests), because a `down` without it leaves Caddy running; and to keep the certificates, remove just the database instead: `docker compose --profile tls down` and then `docker volume rm cla-gate_cla-postgres-data`. On a new machine there is nothing to remove.
2. `up -d --wait postgres` starts only the database. On the empty volume the provisioning script runs by itself and creates the database `cla`, the roles `cla_owner` and `cla_app`, with the passwords in `secrets/`, and the schema `pgboss`.
3. `pg_restore` connects as the administrator `postgres` and creates every object as `cla_owner` (`--role`), without the owner names of the old server (`--no-owner`). `--clean --if-exists` is there because the provisioning step has already created the schema `pgboss`; without it the restore stops at that line. `--exit-on-error` makes any other error stop it instead of being counted and skipped. The grants of `cla_app` come from the dump.
4. `up -d` starts `migrate`, which finds the history in `schema_migrations` and applies only migrations that are newer than the dump, and then `app`. Use the checkout that matches the dump, or a newer one ([upgrade.md](upgrade.md)): an older one makes `migrate` refuse.

### A PostgreSQL server of your own

Provision first, so that the roles exist and own what they should, then restore. `psql` and `pg_restore` of version 15 or later are needed on the machine you run them on, and the administrator must be a superuser, or be allowed to `SET ROLE cla_owner` (on a managed service: `grant cla_owner to <admin>;`).

```sh
export PGHOST=db.internal PGUSER=postgres
CLA_OWNER_PASSWORD_FILE=secrets/db_owner_password CLA_APP_PASSWORD_FILE=secrets/db_app_password sh scripts/provision-database.sh
pg_restore -d cla --no-owner --role=cla_owner --clean --if-exists --exit-on-error cla.dump
```

The script asks for the administrator's password when it runs on a terminal (or reads `PGPASSWORD`, `PGPASSFILE` or `PGSERVICE`), and prints `unchanged` for everything that is already right. It is documented at the top of `scripts/provision-database.sh`. Then start the stack against it with your own `database_url` and `migration_database_url`.

### Check the result

```sh
docker compose exec -T postgres psql -U cla_owner -d cla -Atc "select count(*) from schema_migrations"
ls migrations/*.sql | wc -l
docker compose exec -T postgres psql -U cla_owner -d cla -Atc "select tgname from pg_trigger where tgrelid = 'cla_versions'::regclass and not tgisinternal"
curl -fsS https://cla.example.com/readyz
```

The two counts are equal when the checkout is the version of the dump (the first is smaller after you restored an older dump, until `migrate` has run). The third command lists the triggers that make CLA versions immutable, `cla_versions_immutable` among them; they come back with the dump. `/readyz` answers `{"status":"ready"}`. Then look at the dashboard, and at one signature.

### After the restore

A restore brings back everything that was in the database at the time of the dump, personal data that was erased since included. Erase it again from your list of recorded erasures before the platform serves anybody ([data-protection.md](data-protection.md#after-a-restore)).

## Rehearse it

A backup you never restored is a hope. At least every quarter, and after every major upgrade, restore the newest dump into a scratch stack and look at it:

```sh
cp -r /srv/cla-gate /srv/cla-rehearsal && cd /srv/cla-rehearsal
rm -rf secrets && sh scripts/init-secrets.sh
export EDGE_SUBNET=172.31.31.0/24
docker compose -p cla-rehearsal up -d --wait postgres
docker compose -p cla-rehearsal exec -T postgres pg_restore -U postgres -d cla --no-owner --role=cla_owner --clean --if-exists --exit-on-error < /var/backups/cla-gate/cla-2026-11-03.dump
docker compose -p cla-rehearsal exec -T postgres psql -U cla_owner -d cla -Atc "select count(*) from signatures"
docker compose -p cla-rehearsal down -v
```

The scratch stack has its own project name, so its volumes are its own and nothing touches the running stack, and only `postgres` starts, so no port of the host is used. Write down how long it took and what you had to look up: that is your recovery time.
