#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Giovanni Manzoni
#
# E19-S03: provisions the database and its two roles, for the compose stack, an operator's own server and a developer's
# LAN server. Idempotent (a second run changes nothing and says `unchanged` for every step), and it never drops anything.
#
#   Administrator   libpq's own variables: PGHOST, PGPORT, PGUSER, PGDATABASE (default postgres), PGSSLMODE, PGPASSWORD,
#                   PGPASSFILE, PGSERVICE. With none of PGPASSWORD, PGPASSFILE or PGSERVICE and a terminal on stdin the
#                   script asks for the password with echo off; without a terminal libpq's rules apply, so a local
#                   socket with trust or peer authentication needs none (the first boot of the compose stack).
#   Inputs          CLA_DB_NAME (default cla), CLA_OWNER_ROLE (default cla_owner), CLA_OWNER_PASSWORD and
#                   CLA_APP_PASSWORD. Each can also come from <NAME>_FILE, a file with the value (one trailing newline
#                   is removed, an empty file or an empty variable counts as unset), or, for a password, from a prompt
#                   (asked twice). The runtime role is always cla_app: migration 001 grants to that name.
#   Development     CLA_TEST_ROLE with CLA_TEST_PASSWORD (or _FILE) also creates a role that may create the throw-away
#                   test databases (E19-S10). Refused when NODE_ENV=production.
#   Exit codes      0 done, 2 invalid input, 3 refused because of a conflict (a database that has another owner), 4 no
#                   connection, no usable psql or an SQL error.
#
# Secrets: the administrator password and the role passwords reach psql only through its environment (libpq and \getenv
# in scripts/provision-database.sql), never through argv, a file, a -v assignment, tracing or psql's history. This script
# never prints one. The psql child needs version 15 or later (\getenv).
set +x
set -u
umask 077

# Names are matched with glob classes that spell every character out, so that no locale widens a range.
LOWER='abcdefghijklmnopqrstuvwxyz_'
WORD='abcdefghijklmnopqrstuvwxyz0123456789_'
EXIT_INPUT=2
EXIT_SQL=4

say() {
  printf 'provision-database: %s\n' "$1" >&2
}

refuse_input() {
  say "$1"
  exit "$EXIT_INPUT"
}

# valid_name NAME: 1 to 63 characters of [a-z0-9_], not starting with a digit.
valid_name() {
  case $1 in
    '' | [!"$LOWER"]* | *[!"$WORD"]*) return 1 ;;
  esac
  [ "${#1}" -le 63 ]
}

# read_file_value VARIABLE FILE: the content of FILE with one trailing newline (LF or CRLF) removed, in $file_value.
read_file_value() {
  if [ ! -f "$2" ] || [ ! -r "$2" ]; then
    refuse_input "$1_FILE: cannot read $2 (not a readable file)"
  fi
  file_size=$(wc -c <"$2" | tr -d ' ')
  if [ "$file_size" -gt 65536 ]; then
    refuse_input "$1_FILE: file is larger than 64 KiB"
  fi
  file_value=$(
    cat -- "$2"
    printf x
  )
  file_value=${file_value%x}
  newline='
'
  carriage=$(printf '\r')
  case $file_value in
    *"$carriage$newline") file_value=${file_value%"$carriage$newline"} ;;
    *"$newline") file_value=${file_value%"$newline"} ;;
  esac
}

# resolve VARIABLE DEFAULT: sets $VARIABLE from itself, else from the file named by ${VARIABLE}_FILE, else DEFAULT. An
# empty value counts as unset. The variable names are constants of this script, never input, so eval is safe here.
resolve() {
  eval "direct=\${$1-}"
  eval "file=\${$1_FILE-}"
  if [ -n "$direct" ] && [ -n "$file" ]; then
    refuse_input "$1, $1_FILE: set only one"
  fi
  if [ -n "$file" ]; then
    read_file_value "$1" "$file"
    direct=$file_value
  fi
  if [ -z "$direct" ]; then
    direct=$2
  fi
  eval "$1=\$direct"
}

restore_terminal() {
  stty "$saved_terminal" 2>/dev/null
}

# read_hidden PROMPT: prints PROMPT on stderr, then reads one line from the terminal with echo off, into $hidden_value.
# Echo goes off before the prompt appears, so that nothing typed in answer to it can be shown.
read_hidden() {
  saved_terminal=$(stty -g 2>/dev/null) || saved_terminal=''
  trap restore_terminal EXIT
  trap 'exit 130' INT TERM HUP
  stty -echo 2>/dev/null
  printf '%s' "$1" >&2
  hidden_value=''
  IFS= read -r hidden_value || hidden_value=''
  restore_terminal
  trap - EXIT INT TERM HUP
  printf '\n' >&2
}

# prompt_password ROLE: asks twice on a terminal; an empty first answer keeps the password of an existing role.
prompt_password() {
  read_hidden "Password for $1 (at least 16 characters; empty keeps the password of an existing role): "
  first_entry=$hidden_value
  if [ -n "$first_entry" ]; then
    read_hidden "Repeat the password for $1: "
    if [ "$hidden_value" != "$first_entry" ]; then
      refuse_input "the two entries for the password of $1 differ"
    fi
  fi
  prompted=$first_entry
}

# ------------------------------------------------------------------------------------------------- the client
if ! command -v psql >/dev/null 2>&1; then
  say 'psql was not found: install the PostgreSQL client, version 15 or later'
  exit "$EXIT_SQL"
fi
client_major=$(psql --version 2>/dev/null | sed -n 's/[^0-9]*\([0-9][0-9]*\).*/\1/p;q')
if [ -z "$client_major" ] || [ "$client_major" -lt 15 ]; then
  say 'psql 15 or later is needed (the SQL file reads its inputs with \getenv)'
  exit "$EXIT_SQL"
fi

script_directory=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
sql_file=$script_directory/provision-database.sql
if [ ! -r "$sql_file" ]; then
  say "cannot read $sql_file"
  exit "$EXIT_SQL"
fi

# ------------------------------------------------------------------------------------------------- the inputs
resolve CLA_DB_NAME cla
resolve CLA_OWNER_ROLE cla_owner
resolve CLA_TEST_ROLE ''
resolve CLA_OWNER_PASSWORD ''
resolve CLA_APP_PASSWORD ''
resolve CLA_TEST_PASSWORD ''

if ! valid_name "$CLA_DB_NAME"; then
  refuse_input 'CLA_DB_NAME must match ^[a-z_][a-z0-9_]{0,62}$'
fi
if ! valid_name "$CLA_OWNER_ROLE"; then
  refuse_input 'CLA_OWNER_ROLE must match ^[a-z_][a-z0-9_]{0,62}$'
fi
if [ -n "$CLA_TEST_ROLE" ] && ! valid_name "$CLA_TEST_ROLE"; then
  refuse_input 'CLA_TEST_ROLE must match ^[a-z_][a-z0-9_]{0,62}$'
fi
if [ -z "$CLA_TEST_ROLE" ] && [ -n "$CLA_TEST_PASSWORD" ]; then
  refuse_input 'CLA_TEST_PASSWORD needs CLA_TEST_ROLE'
fi
if [ -n "$CLA_TEST_ROLE" ] && [ "${NODE_ENV-}" = production ]; then
  refuse_input 'CLA_TEST_ROLE is a development-only role and is refused when NODE_ENV=production'
fi

if [ -t 0 ]; then
  if [ -z "$CLA_OWNER_PASSWORD" ]; then
    prompt_password "$CLA_OWNER_ROLE"
    CLA_OWNER_PASSWORD=$prompted
  fi
  if [ -z "$CLA_APP_PASSWORD" ]; then
    prompt_password cla_app
    CLA_APP_PASSWORD=$prompted
  fi
  if [ -n "$CLA_TEST_ROLE" ] && [ -z "$CLA_TEST_PASSWORD" ]; then
    prompt_password "$CLA_TEST_ROLE"
    CLA_TEST_PASSWORD=$prompted
  fi
fi

for password_name in CLA_OWNER_PASSWORD CLA_APP_PASSWORD CLA_TEST_PASSWORD; do
  eval "password_value=\${$password_name}"
  if [ -n "$password_value" ] && [ "${#password_value}" -lt 16 ]; then
    refuse_input "$password_name is shorter than 16 characters"
  fi
done

if [ -t 0 ] && [ -z "${PGPASSWORD-}" ] && [ -z "${PGPASSFILE-}" ] && [ -z "${PGSERVICE-}" ]; then
  read_hidden "Administrator password for ${PGUSER:-the administrator} (empty if the server needs none): "
  if [ -n "$hidden_value" ]; then
    PGPASSWORD=$hidden_value
    export PGPASSWORD
  fi
fi

# ------------------------------------------------------------------------------------------------- the run
export CLA_DB_NAME CLA_OWNER_ROLE
for optional in CLA_TEST_ROLE CLA_OWNER_PASSWORD CLA_APP_PASSWORD CLA_TEST_PASSWORD; do
  eval "optional_value=\${$optional}"
  if [ -n "$optional_value" ]; then
    export "${optional?}"
  else
    unset "$optional"
  fi
done
PGDATABASE=${PGDATABASE:-postgres}
export PGDATABASE
PSQL_HISTORY=/dev/null
PSQLRC=/dev/null
export PSQL_HISTORY PSQLRC

# stdout goes through untouched; stderr is read here to find the refusal prefixes of the SQL file, then printed.
status=0
{ errors=$(psql -X -q -w -v ON_ERROR_STOP=1 <"$sql_file" 2>&1 1>&3 3>&-) || status=$?; } 3>&1
if [ -n "$errors" ]; then
  printf '%s\n' "$errors" >&2
fi
if [ "$status" -ne 0 ]; then
  case $errors in
    *'provision-database: conflict: '*) exit 3 ;;
    *'provision-database: invalid: '*) exit "$EXIT_INPUT" ;;
  esac
  exit "$EXIT_SQL"
fi

app_url="postgres://cla_app:<password>@HOST:PORT/$CLA_DB_NAME"
owner_url="postgres://$CLA_OWNER_ROLE:<password>@HOST:PORT/$CLA_DB_NAME"
printf '\nThe application takes these connection strings; replace <password> with the password of the role and\n'
printf 'percent-encode special characters in it (for example @ as %%40 and / as %%2F):\n'
printf '  DATABASE_URL=%s\n' "$app_url"
printf '  MIGRATION_DATABASE_URL=%s\n' "$owner_url"
exit 0
