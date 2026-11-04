# Running the tests against a PostgreSQL server

`yarn test` needs no database: it runs on in-memory PGlite, which speaks PostgreSQL 18. Set `DATABASE_URL` and the same suite runs on a real server instead. The CI `postgres` job does that in a disposable container, and the tests that PGlite cannot run (lock waits, races between connections, roles) run nowhere else. This page is for the developer who points the suite at a server of their own, for example a PostgreSQL on the LAN. The rest of the local setup is in [`development.md`](../development.md).

## What a run does to the server

- The global setup (`src/server/adapters/db/global-setup.ts`) connects to the database that `DATABASE_URL` names, creates a database called `cla_test_<random>` (twelve hex characters), hands its address to the tests and drops it when the run ends. Every test works inside that throw-away database. The database the URL names is only read, to apply the guard below; nothing is ever written into it.
- The guard: the setup refuses to start when the database the URL names already contains a table `schema_migrations`, the table the migrator creates, because such a database is an application database. The run stops with a message that begins `DATABASE_URL names the database "<name>", which already contains schema_migrations`, and nothing is created. `CLA_TEST_ALLOW_APP_DATABASE=1` lifts the refusal for a database that really is a throw-away one; only the value `1` counts.
- A run that ends drops its database, also when tests failed. A process that is killed outright leaves it behind. List the leftovers and drop them by hand:

  ```sql
  select datname from pg_database where datname like 'cla\_test\_%';
  drop database cla_test_0123456789ab with (force);
  ```

- On a real server the test files run one at a time, so a full run takes longer than on PGlite.

## Use a server that holds nothing you need

Databases are separate, roles are not: a role is an object of the whole server. The suite needs the runtime role `cla_app` (migration 001 grants to it, and the tests create it when it is missing), and the suites that run with `CLA_ROLE_TESTS=1` create, rename, alter and drop roles of their own while they test the provisioning script. Dropping the throw-away database undoes none of that. Therefore:

- Use a dedicated test server: a container, a spare machine, a PostgreSQL on the LAN that exists for this.
- Never use a server that holds real signatures. They are legal evidence, and a test run is not something to expose them to. Never use the server of an operator stack ([install](../operations/install.md)) either.
- Do not run two suites against one server at the same time when `CLA_ROLE_TESTS=1` is set, because they would change the same roles.

Do not export a production `DATABASE_URL` in a shell that also runs `yarn test` or `yarn dev`. `yarn test` would connect to that server with those credentials and create and drop databases there, and `yarn dev` and `yarn db:migrate` use a `DATABASE_URL` or `MIGRATION_DATABASE_URL` that is already set instead of the development database, so the migrations would run on production. The guard stops the usual case (the URL names the application database), but not a production user that names another database. Keep production credentials out of the shell you develop in, and give the test URL on the command line of the run (`DATABASE_URL=... yarn test`) instead of exporting it.

## The test role

The user in `DATABASE_URL` must be allowed to create databases. It does not need to be a superuser, and for the ordinary suite it should not be one. `scripts/provision-database.sh` creates such a role when `CLA_TEST_ROLE` is set, together with `CLA_TEST_PASSWORD` or `CLA_TEST_PASSWORD_FILE` (at least 16 characters; the header of the script lists all its inputs). The role can log in, create databases and roles, is not a superuser, belongs to neither application role, and has no `CONNECT` on the application database `cla`, so it cannot read the data of the stack it sits next to. The script refuses to create it when `NODE_ENV=production`. Because the role cannot connect to `cla`, the URL names the maintenance database `postgres`.

One more statement is needed, once, after the script. Tests that act as the runtime role (`set local role cla_app`) must be allowed to switch into it, and the script keeps the test role out of both application roles on purpose: it removes any membership between them whenever it runs. Without the statement those tests fail with `permission denied to set role "cla_app"`. With it, the whole server suite passes as the test role, the tests that need `CLA_ROLE_TESTS=1` excepted (below). Run the statement again after every later run of the script:

```sql
grant cla_app to cla_test with inherit false, set true;
```

The development database of `yarn db:up` has the roles `cla_owner` (no `CREATEDB`) and `cla_app`, so add the test role to it. The script is idempotent, so it can be run again at any time; it runs in the container, which already holds the other inputs:

```sh
yarn db:up
(umask 077 && openssl rand -hex 16 > .local/test-role-password)
export CLA_TEST_ROLE=cla_test CLA_TEST_PASSWORD="$(cat .local/test-role-password)"
docker exec -e CLA_TEST_ROLE -e CLA_TEST_PASSWORD -e PGUSER=postgres \
  cla-gate-dev-postgres-1 sh /docker-entrypoint-initdb.d/10-provision-database.sh
docker exec cla-gate-dev-postgres-1 psql -U postgres -c 'grant cla_app to cla_test with inherit false, set true'
PORT=$(yarn db:url | sed -n 's/^POSTGRES_PORT=//p')
DATABASE_URL="postgres://cla_test:$CLA_TEST_PASSWORD@127.0.0.1:$PORT/postgres" yarn test
```

`yarn db:up` picks the port, so the page names none; `yarn db:url` prints it. The password is hexadecimal, so the URL needs no percent-encoding; a password with other characters needs it. `.local/` is ignored by Git.

On a server of your own, run the same script from a checkout on any machine that has `psql` 15 or later. The administrator is named by libpq's variables (`PGHOST`, `PGPORT`, `PGUSER`, and a password from `PGPASSWORD`, `PGPASSFILE` or a prompt). The script also provisions the application database and its two roles, so it needs their passwords; on a test server they are throw-away values:

```sh
(umask 077 && for name in owner app test; do openssl rand -hex 16 > ".local/$name-password"; done)
PGHOST=test-db.lan PGUSER=postgres \
  CLA_OWNER_PASSWORD_FILE=.local/owner-password CLA_APP_PASSWORD_FILE=.local/app-password \
  CLA_TEST_ROLE=cla_test CLA_TEST_PASSWORD_FILE=.local/test-password \
  sh scripts/provision-database.sh
psql -h test-db.lan -U postgres -c 'grant cla_app to cla_test with inherit false, set true'
```

## Real-Postgres-only suites

A test that PGlite cannot run is marked `realPostgresOnly`. It is skipped with the reason `needs real Postgres` when `DATABASE_URL` is not set, and runs as soon as it is. A test that creates or alters roles (`realPostgresRolesOnly`, among them the tests of `scripts/provision-database.sh`) also needs `CLA_ROLE_TESTS=1` and is skipped with the reason `needs CLA_ROLE_TESTS=1` without it:

```sh
CLA_ROLE_TESTS=1 yarn test
```

Set `CLA_ROLE_TESTS=1` only against a dedicated test server, and run those tests as a superuser of it, not as the test role: they rename and alter `cla_app` and create roles with attributes of their own, and as the test role they fail with `permission denied to rename role`. The next section gives a superuser on a server that exists for the run. `REQUIRE_REAL_POSTGRES=1` turns a skip into a failure when the run falls back to PGlite, which is how the CI job notices a missing database (it sets both flags). The tests of the provisioning script run `psql` in the container that `CLA_PG_CONTAINER` names when it is set, and otherwise the `psql` of the host, which must then be version 15 or later.

A guard test in `src/server/adapters/db/global-setup.test.ts` backs everything above. It creates a sentinel database with a table and a row, runs the setup and the teardown of the suite against that server, and checks that the sentinel is unchanged and that the set of databases afterwards equals the set before. It also checks that a database that holds `schema_migrations` is refused, with nothing created, and that only `CLA_TEST_ALLOW_APP_DATABASE=1` lifts the refusal.

## The CI way

CI creates its throw-away `cla_test_<hex>` databases only in the container that `scripts/ci/postgres.ts` starts: the pinned image, a random free loopback port above 32768, a name that is unique per run, removed afterwards by a step that runs even when the job failed ([CI runners](../ci-runners.md)). The same helper gives a disposable server on a developer's machine, with no fixed port. Outside CI it prints the two variables it would export, so `eval` them:

```sh
eval "$(yarn ci:postgres start | sed -n 's/^\(CLA_PG_CONTAINER\|DATABASE_URL\)=/export &/p')"
CLA_ROLE_TESTS=1 REQUIRE_REAL_POSTGRES=1 yarn test
yarn ci:postgres stop
```

The user of that `DATABASE_URL` is the superuser of a container that exists for minutes, so it needs no test role and may run the role tests.
