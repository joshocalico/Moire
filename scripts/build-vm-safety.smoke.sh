#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/nix" "$fixture/vm/nixos"
cp "$root/nix/build-in-guest.sh" "$fixture/nix/build-in-guest.sh"
printf 'preserve this immutable fallback' > "$fixture/vm/nixos/reserved.iso"
if bash "$fixture/nix/build-in-guest.sh" reserved.iso > "$fixture/error" 2>&1; then
  echo 'Existing output was accepted' >&2; exit 1
fi
[[ "$(cat "$fixture/vm/nixos/reserved.iso")" == 'preserve this immutable fallback' ]]
rg -q 'Image already exists' "$fixture/error"
if bash "$fixture/nix/build-in-guest.sh" ../escape.iso > "$fixture/error" 2>&1; then
  echo 'Non-basename output was accepted' >&2; exit 1
fi
rg -q 'Usage:' "$fixture/error"
echo 'VM build output: existing fallback and path traversal refused'
