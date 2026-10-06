#!/usr/bin/env bash
# Optional bridge for Macs that have Nix in an existing ARM64 Parallels guest.
set -euo pipefail
VM="${MOIRE_BUILD_VM:-MoireDev}"
GUEST_REPO="${MOIRE_GUEST_REPO:-/media/psf/moire}"
exec prlctl exec "$VM" bash "$GUEST_REPO/nix/build-in-guest.sh" "$@"
