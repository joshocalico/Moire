#!/usr/bin/env python3
"""Record a source snapshot and fallback hashes before building a fresh VM image."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--evidence", required=True)
parser.add_argument("--image", required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
image = root / args.image
if image.exists():
    parser.error("Choose a fresh image filename; existing images are fallbacks.")
out = root / args.evidence
out.mkdir(parents=True, exist_ok=True)
if (out / "host-source-sha256.json").exists():
    parser.error("Choose a fresh evidence directory; an existing snapshot is preserved.")
excluded = {".git", "node_modules", "dist", "vm", ".pnpm-store", ".cursor", "__pycache__"}
files = sorted(p for p in root.rglob("*") if p.is_file() and not p.is_symlink()
    and not excluded.intersection(p.relative_to(root).parts)
    and not any(part.startswith("result") for part in p.relative_to(root).parts)
    and p.name != ".DS_Store" and not p.name.startswith(".env")
    and p.suffix not in {".log", ".tsbuildinfo", ".pyc"})

def sha(file):
    with file.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()

def write(name, value):
    (out / name).write_text(json.dumps(value, indent=2) + "\n")

write("host-source-sha256.json", {str(p.relative_to(root)): sha(p) for p in files})
with tarfile.open(out / "source-snapshot.tar.gz", "w:gz") as archive:
    for p in files:
        archive.add(p, arcname=str(p.relative_to(root)), recursive=False)
for name, command in [("git-head.txt", ["git", "rev-parse", "HEAD"]),
                      ("git-status.txt", ["git", "status", "--short"]),
                      ("git-tracked-diff.patch", ["git", "diff", "--binary"])]:
    (out / name).write_bytes(subprocess.check_output(command, cwd=root))
fallbacks = {str(p.relative_to(root)): {"bytes": p.stat().st_size, "sha256": sha(p)}
             for p in sorted((root / "vm/nixos").glob("*.iso"))}
write("fallback-images-before.json", fallbacks)
write("build-command.json", {"command": f"./scripts/build-vm-in-parallels.sh {image.name}",
                             "sourceFiles": len(files), "fallbacks": len(fallbacks)})
print(f"Recorded {len(files)} source files and {len(fallbacks)} fallback images in {out}")
