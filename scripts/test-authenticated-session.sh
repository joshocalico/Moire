#!/usr/bin/env bash
# Harmless command-fixture tests only. Never starts systemd units or a VM.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node "$root/apps/system/session/src/authenticated-session.smoke.mjs"
