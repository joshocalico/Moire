#!/usr/bin/env bash
set -euo pipefail
OUTPUT_NAME="${1:-moire-aarch64.iso}"
IMAGE_PACKAGE="${2:-moire-vm}"
[[ "$#" -le 2 && "$OUTPUT_NAME" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*\.iso$ &&
   ( "$IMAGE_PACKAGE" == moire-vm || "$IMAGE_PACKAGE" == moire-storage-probe || "$IMAGE_PACKAGE" == moire-removable-desktop || "$IMAGE_PACKAGE" == moire-pam-test ) ]] || {
  echo "Usage: $0 [output-name.iso] [moire-vm|moire-storage-probe|moire-removable-desktop|moire-pam-test]" >&2
  exit 1
}
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Every exported image is a fallback until the user removes it explicitly.
[[ ! -e "$ROOT/vm/nixos/$OUTPUT_NAME" ]] || {
  echo "Image already exists: $OUTPUT_NAME. Choose a fresh output filename." >&2
  exit 1
}
export PATH="/nix/var/nix/profiles/default/bin:$PATH"
command -v nix >/dev/null || {
  echo "Install Nix in the ARM64 Linux build guest first." >&2
  exit 1
}
[[ "$(uname -m)" == aarch64 ]] || {
  echo "This helper requires an ARM64 Linux build guest." >&2
  exit 1
}

# Use a native guest filesystem. Include current source edits and untracked
# source files, while keeping host node_modules and large VM files out of Nix.
SOURCE="$(mktemp -d /var/tmp/moire-nix.XXXXXXXX)"
trap 'rm -rf "$SOURCE"' EXIT
rsync -a \
  --exclude .git --exclude node_modules --exclude dist --exclude vm \
  --exclude 'result*' --exclude .pnpm-store --exclude .cursor \
  --exclude '*.tsbuildinfo' --exclude '*.log' --exclude .DS_Store \
  --exclude __pycache__ --exclude '*.pyc' \
  --exclude .env --exclude '.env.*' \
  "$ROOT/" "$SOURCE/"
cd "$SOURCE"
nix --extra-experimental-features 'nix-command flakes' build \
  ".#$IMAGE_PACKAGE" -L --max-jobs 2 --cores 4

mkdir -p "$ROOT/vm/nixos"
IMAGE_FILENAME=moire-aarch64.iso
if [[ "$IMAGE_PACKAGE" == moire-pam-test ]]; then IMAGE_FILENAME=moire-aarch64-pam-test.iso; fi
cp "result/iso/$IMAGE_FILENAME" "$ROOT/vm/nixos/$OUTPUT_NAME.tmp.$$"
mv "$ROOT/vm/nixos/$OUTPUT_NAME.tmp.$$" "$ROOT/vm/nixos/$OUTPUT_NAME"
echo "Built $ROOT/vm/nixos/$OUTPUT_NAME"
