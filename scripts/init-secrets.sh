#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Giovanni Manzoni
#
# E19-S04: prepares the operator stack (docker-compose.yml): the secret files it mounts and the .env it reads. Run it from
# anywhere; it works on the checkout it lives in. Idempotent: it creates only what does not exist yet and never changes,
# overwrites or deletes a file that does, so it is safe to run again after an upgrade.
#
#   secrets/            mode 0700. Generated (64 hex characters each, `openssl rand -hex 32` or /dev/urandom):
#                       db_admin_password, db_owner_password, db_app_password, session_secret, setup_token.
#                       Derived from the two role passwords (so they hold the passwords of the files above, or of the
#                       files you wrote yourself): database_url (cla_app) and migration_database_url (cla_owner).
#                       Empty placeholders for what exists only after the first-run setup or during a rotation:
#                       github_app_private_key, github_webhook_secret, github_client_secret,
#                       github_app_private_key_previous, github_webhook_secret_previous.
#   secrets/* files     mode 0444 inside the 0700 directory: a bind-mounted file secret keeps the owner and mode of the
#                       host file, and the container user (10001) could not read a 0400 file that belongs to you. The
#                       directory is what keeps other users of this host out.
#   .env                a copy of .env.example when there is none: the non-secret settings (PUBLIC_BASE_URL first).
#
# Output: the names of the files it created, never a value, and where the setup token is. Exit codes: 0 done, 1 a file or
# a value could not be used (the message names the file and never its content).
set +x
set -eu
umask 077
# The character classes below are spelled out for the C locale, so that no locale widens a range.
LC_ALL=C
export LC_ALL

# The checkout is the parent directory of the directory this script is in.
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
secrets_directory=$root/secrets
temporary=$secrets_directory/.new.$$
created=''

say() {
  printf 'init-secrets: %s\n' "$1" >&2
}

fail() {
  say "$1"
  exit 1
}

cleanup() {
  rm -f "$temporary"
}
trap cleanup EXIT
trap 'exit 1' INT TERM HUP

# valid_hex VALUE: exactly 64 characters, all of them lower case hexadecimal digits.
valid_hex() {
  [ "${#1}" -eq 64 ] || return 1
  case $1 in
    *[!0-9a-f]*) return 1 ;;
  esac
  return 0
}

# random_hex: 64 hexadecimal characters (256 bits) in $random_value, from openssl when it works, else from the kernel.
random_hex() {
  random_value=''
  if command -v openssl >/dev/null 2>&1; then
    random_value=$(openssl rand -hex 32 2>/dev/null) || random_value=''
  fi
  if ! valid_hex "$random_value"; then
    random_value=$(dd if=/dev/urandom bs=32 count=1 2>/dev/null | od -An -v -tx1 | tr -d ' \n') || random_value=''
  fi
  if ! valid_hex "$random_value"; then
    random_value=''
    fail 'no source of randomness: install openssl, or make /dev/urandom readable'
  fi
}

# exists_already NAME: true when secrets/NAME is a file, a directory or a link (a dangling one too): it is never replaced.
exists_already() {
  [ -e "$secrets_directory/$1" ] || [ -L "$secrets_directory/$1" ]
}

# create NAME VALUE: writes secrets/NAME with VALUE and a newline, mode 0444, unless it exists. The value is written to a
# temporary file first and linked into place, so a failure half way never leaves a short file that the next run would
# take for a finished one, and a file that appeared in the meantime is never overwritten (ln does not replace).
create() {
  if exists_already "$1"; then
    return 0
  fi
  printf '%s\n' "$2" >"$temporary"
  chmod 0444 "$temporary"
  ln "$temporary" "$secrets_directory/$1"
  rm -f "$temporary"
  created="$created secrets/$1"
}

# create_empty NAME: the same with no content, for the files that stay empty until the GitHub App exists.
create_empty() {
  if exists_already "$1"; then
    return 0
  fi
  : >"$temporary"
  chmod 0444 "$temporary"
  ln "$temporary" "$secrets_directory/$1"
  rm -f "$temporary"
  created="$created secrets/$1"
}

# password_of NAME: the content of secrets/NAME without the line break, in $password. A password goes into a URL, so only
# characters that need no percent-encoding are accepted; the generated ones are hexadecimal.
password_of() {
  password=$(cat -- "$secrets_directory/$1")
  if [ -z "$password" ]; then
    fail "secrets/$1 is empty: write a password into it, or delete it and run this script again"
  fi
  case $password in
    *[!A-Za-z0-9._~-]*)
      fail "secrets/$1 has characters that a URL cannot carry as they are: percent-encode it into secrets/$2 yourself, or use letters, digits and . _ ~ - only"
      ;;
  esac
}

# ------------------------------------------------------------------------------------------------- the directory
if [ -e "$secrets_directory" ] && [ ! -d "$secrets_directory" ]; then
  fail "$secrets_directory exists and is not a directory"
fi
if [ ! -d "$secrets_directory" ]; then
  mkdir "$secrets_directory"
  chmod 0700 "$secrets_directory"
fi

# ------------------------------------------------------------------------------------------------- generated
for name in db_admin_password db_owner_password db_app_password session_secret setup_token; do
  if ! exists_already "$name"; then
    random_hex
    create "$name" "$random_value"
  fi
done
random_value=''

# ------------------------------------------------------------------------------------------------- derived
if ! exists_already database_url; then
  password_of db_app_password database_url
  create database_url "postgres://cla_app:$password@postgres:5432/cla"
fi
if ! exists_already migration_database_url; then
  password_of db_owner_password migration_database_url
  create migration_database_url "postgres://cla_owner:$password@postgres:5432/cla"
fi
password=''

# ------------------------------------------------------------------------------------------------- placeholders
for name in github_app_private_key github_webhook_secret github_client_secret github_app_private_key_previous github_webhook_secret_previous; do
  create_empty "$name"
done

# ------------------------------------------------------------------------------------------------- .env
if [ ! -e "$root/.env" ]; then
  if [ ! -r "$root/.env.example" ]; then
    fail "cannot read $root/.env.example"
  fi
  cp -- "$root/.env.example" "$root/.env"
  created="$created .env"
fi

# ------------------------------------------------------------------------------------------------- the report
if [ -z "$created" ]; then
  printf 'nothing to do: every secret file and .env exist already\n'
else
  for file in $created; do
    printf 'created %s\n' "$file"
  done
fi
printf 'The setup token that unlocks /setup is in secrets/setup_token.\n'
exit 0
