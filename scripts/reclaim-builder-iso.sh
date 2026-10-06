#!/usr/bin/env bash
# Run inside the existing builder. Delete only an unreferenced, hash-verified
# store duplicate of a preserved host fallback; never run broad store GC.
set -euo pipefail
[[ $# == 3 ]] || { echo 'Usage: reclaim-builder-iso.sh STORE_PATH HOST_ISO SHA256' >&2; exit 1; }
candidate="$1"
fallback="$2"
expected="$3"
[[ "$candidate" =~ ^/nix/store/[a-z0-9]{32}-moire-aarch64\.iso$ ]]
[[ "$fallback" =~ ^/media/psf/moire/vm/nixos/[a-zA-Z0-9._-]+\.iso$ ]]
[[ "$expected" =~ ^[a-f0-9]{64}$ ]]
export PATH="/nix/var/nix/profiles/default/bin:$PATH"
[[ -f "$fallback" && -f "$candidate/iso/moire-aarch64.iso" ]]
[[ $(sha256sum "$fallback" | cut -d' ' -f1) == "$expected" ]]
[[ $(sha256sum "$candidate/iso/moire-aarch64.iso" | cut -d' ' -f1) == "$expected" ]]
[[ -z $(nix-store --query --roots "$candidate") ]]
[[ -z $(nix-store --query --referrers "$candidate") ]]
nix-store --delete "$candidate"
[[ -f "$fallback" ]]
df -h /nix
