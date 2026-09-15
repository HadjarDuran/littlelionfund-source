#!/usr/bin/env bash
# Deploy command for Cloudflare's Git-integration ("Workers Builds") pipeline.
#
# Why this exists: dashboard-added runtime secrets on a Git-connected Worker
# have two known Cloudflare failure modes that produce the exact same
# symptom (the secret is undefined in `env` at request time even though it
# looks "added" in the dashboard) --
#   1. the value was entered under Settings > Build configuration > Build
#      variables and secrets, which only exists as process.env during this
#      build script, and is never bound to the deployed Worker on its own;
#   2. or it really was set as a runtime secret, but a subsequent
#      Git-integration deploy silently wiped it (a reported Cloudflare
#      Workers Builds issue, not something this repo's code can prevent
#      from happening again on its own).
#
# `wrangler deploy --secrets-file` re-applies secrets additively on every
# single deploy, taking their values from this build's own environment (set
# as Build variables and secrets in the dashboard) -- so this fixes case 1
# by actually binding them at all, and makes case 2 a non-issue since every
# deploy re-sets them regardless of what happened to the previous one.
set -euo pipefail
cd "$(dirname "$0")/.."

REQUIRED_SECRETS=(HOLDINGS_PWD WEIGHTINGS_PWD FINNHUB_KEY KV_REST_API_URL KV_REST_API_TOKEN)
OPTIONAL_SECRETS=(SESSION_SECRET LION_REST_API_URL LION_REST_API_TOKEN)

SECRETS_FILE="$(mktemp)"
trap 'rm -f "$SECRETS_FILE"' EXIT

: > "$SECRETS_FILE"
missing=()
for name in "${REQUIRED_SECRETS[@]}"; do
  value="${!name-}"
  if [ -n "$value" ]; then
    echo "${name}=${value}" >> "$SECRETS_FILE"
  else
    missing+=("$name")
  fi
done
for name in "${OPTIONAL_SECRETS[@]}"; do
  value="${!name-}"
  if [ -n "$value" ]; then
    echo "${name}=${value}" >> "$SECRETS_FILE"
  fi
done

if [ "${#missing[@]}" -gt 0 ]; then
  echo "warning: not set in this build's environment, so they won't be updated on the Worker: ${missing[*]}" >&2
  echo "Add them under Settings > Build configuration > Build variables and secrets (as type Secret) for this project -- not the Worker's own Settings > Variables and Secrets tab, which is a separate store this build script can't read from." >&2
fi

npx wrangler deploy --secrets-file "$SECRETS_FILE"
