#!/usr/bin/env python3
"""Verify a copied ISO, packaged runtime payload and preserved fallback images."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--image", required=True)
parser.add_argument("--evidence", required=True)
parser.add_argument("--builder", default=os.environ.get("MOIRE_BUILD_VM", "MoireDev"))
parser.add_argument("--build-log", action="append", help="Evidence log filename; repeat for cached retries")
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
evidence = (root / args.evidence).resolve()
image_file = (root / args.image).resolve()
logs = args.build_log or ["build.log"]
log = "\n".join((evidence / name).read_text() for name in logs)
package = re.findall(r"patching script interpreter paths in (/nix/store/[a-z0-9]+-moire-0\.0\.0)/lib/moire/apps", log)[-1]
image = re.findall(r"stdio:(/nix/store/[a-z0-9]+-moire-aarch64\.iso)/iso/moire-aarch64\.iso", log)[-1]
expected = json.loads((evidence / "host-source-sha256.json").read_text())
payload = [name for name in expected if "verification" not in Path(name).parts and ((
    name.startswith(("apps/", "packages/", "themes/", "docs/")) and
    Path(name).suffix in (".ts", ".tsx", ".json", ".svg", ".png", ".desktop", ".md",
                          ".ttf", ".otf", ".txt", ".script", ".plymouth", ".mjs", ".mts", ".xml")
) or name in ("package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"))]

def sha(file):
    digest = hashlib.sha256()
    with open(file, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()

script = """#!/usr/bin/env bash
set -euo pipefail
export PATH=/nix/var/nix/profiles/default/bin:$PATH
python3 - <<'GUEST'
import hashlib,json,subprocess
package=PACKAGE_VALUE
image=IMAGE_VALUE
files=PAYLOAD_VALUE
def sha(file):
 h=hashlib.sha256()
 with open(file,'rb') as stream:
  for block in iter(lambda:stream.read(1024*1024),b''):h.update(block)
 return h.hexdigest()
result={'package':package,'imageStorePath':image,'builderImageSha256':sha(image+'/iso/moire-aarch64.iso'),'packagedSourceSha256':{name:sha(package+'/lib/moire/'+name) for name in files}}
for label,path in [('package',package),('image',image)]:
 drv=subprocess.check_output(['nix-store','--query','--deriver',path],text=True).strip()
 result[label+'DerivationPath']=drv
 result[label+'Derivation']=json.loads(subprocess.check_output(['nix','--extra-experimental-features','nix-command flakes','derivation','show',drv],text=True))
print(json.dumps(result))
GUEST
""".replace("PACKAGE_VALUE", repr(package)).replace("IMAGE_VALUE", repr(image)).replace("PAYLOAD_VALUE", repr(payload))
(evidence / "verify-guest.sh").write_text(script)
guest_evidence = Path("/media/psf/moire") / evidence.relative_to(root)
run = subprocess.run(["prlctl", "exec", args.builder, "bash", str(guest_evidence / "verify-guest.sh")], text=True, capture_output=True, timeout=120)
(evidence / "builder-provenance.stdout.log").write_text(run.stdout)
(evidence / "builder-provenance.stderr.log").write_text(run.stderr)
run.check_returncode()
data = json.loads(run.stdout)
(evidence / "builder-provenance.json").write_text(json.dumps(data, indent=2) + "\n")
assert all(data["packagedSourceSha256"][name] == expected[name] for name in payload), "Packaged payload differs from recorded source"
# Documentation may gain acceptance notes after the build; runtime must stay frozen.
runtime = [name for name in payload if not name.startswith("docs/")]
assert all(sha(root / name) == expected[name] for name in runtime), "Runtime source changed during build"
image_hash = sha(image_file)
assert image_hash == data["builderImageSha256"], "Copied ISO differs from Nix output"
fallbacks = json.loads((evidence / "fallback-images-before.json").read_text())
for name, record in fallbacks.items():
    assert sha(root / name) == record["sha256"], f"Fallback changed: {name}"
(evidence / "fallback-images-after.json").write_text(json.dumps(fallbacks, indent=2) + "\n")
metadata = {
    "image": str(image_file), "sha256": image_hash, "bytes": image_file.stat().st_size,
    "package": package, "imageStorePath": image,
    "matchedPackagedSourceFiles": len(payload), "copiedIsoMatchesNixOutput": True,
    "fallbackImagesPreserved": len(fallbacks), "status": "build and provenance verified; live acceptance pending",
    "gitHead": (evidence / "git-head.txt").read_text().strip(), "sourceState": "recorded dirty checkout and untracked source",
}
(evidence / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
(evidence / "image.sha256").write_text(f"{image_hash}  {image_file}\n")
print(json.dumps(metadata, indent=2))
