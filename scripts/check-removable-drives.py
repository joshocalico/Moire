#!/usr/bin/env python3
"""Run the focused source-only storage checks and save actual exits and source pins."""
import argparse
import hashlib
import json
import os
import signal
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--output", required=True, type=Path, help="New directory for check receipts")
args = parser.parse_args()
output = args.output.resolve()
if output.exists():
    parser.error("output already exists; choose a new receipt directory")
output.mkdir(parents=True)
loader = "./apps/system/compositor/node_modules/tsx/dist/loader.mjs"
tests = [
    ("boundary", "packages/system-management/src/storage-status.smoke.ts"),
    ("udisks", "apps/system/management-service/src/udisks-storage.smoke.ts"),
    ("service", "apps/system/management-service/src/storage-controls.smoke.ts"),
    ("files", "apps/bundled/files/src/removable-drives.smoke.tsx"),
    ("tabs-regression", "apps/bundled/files/src/tabs.smoke.tsx"),
    ("places-regression", "apps/bundled/files/src/places.smoke.ts"),
]
commands = [(name, ["node", "--import", loader, path]) for name, path in tests]
for name, package in [("shared-types", "packages/system-management"),
                      ("service-types", "apps/system/management-service"),
                      ("files-types", "apps/bundled/files")]:
    commands.append((name, ["node_modules/.bin/tsc", "-p", f"{package}/tsconfig.json", "--noEmit"]))
sources = [
    "packages/system-management/src/storage-status.ts",
    "packages/system-management/package.json",
    "apps/system/management-service/src/udisks-storage.ts",
    "apps/system/management-service/src/storage-controls.ts",
    "apps/system/management-service/src/main.ts",
    "apps/bundled/files/src/main.tsx",
    "apps/bundled/files/src/removable-drives.ts",
    "apps/bundled/files/src/removable-drive-row.tsx",
    "apps/bundled/files/package.json", "pnpm-lock.yaml",
    "scripts/check-removable-drives.py",
] + [path for _, path in tests]
changed_typescript = [path for path in sources if path.endswith((".ts", ".tsx"))
                      and not path.endswith(("tabs.smoke.tsx", "places.smoke.ts"))]
commands.extend([
    ("scoped-lint", ["node_modules/.bin/oxlint", "--threads=1", *changed_typescript]),
    ("scoped-format", ["node_modules/.bin/oxfmt", "--check", *changed_typescript]),
])
for directory in ["packages/dbus/src", "packages/ui/src", "packages/prefs/src",
                  "packages/app-discovery/src", "packages/system-management/src",
                  "apps/bundled/files/src", "apps/system/management-service/src"]:
    sources.extend(str(path.relative_to(ROOT)) for path in (ROOT / directory).rglob("*")
                   if path.is_file() and path.suffix in {".ts", ".tsx"})
sources = sorted(set(sources))
def pins():
    return {path: hashlib.sha256((ROOT / path).read_bytes()).hexdigest() for path in sources}
before = pins()
results = []
for name, command in commands:
    start = time.monotonic()
    timed_out = False
    environment = os.environ.copy()
    if name == "files":
        environment["MOIRE_DRIVES_CAPTURE"] = str(output / "screenshots")
    with (output / f"{name}.log").open("w") as log:
        run = subprocess.Popen(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT,
                               start_new_session=True, env=environment)
        try:
            code = run.wait(timeout=120)
        except subprocess.TimeoutExpired:
            timed_out = True
            os.killpg(run.pid, signal.SIGTERM)
            try:
                run.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(run.pid, signal.SIGKILL)
                run.wait()
            code = 124
            log.write("\nFocused check exceeded 120 seconds.\n")
        def group_live():
            try:
                os.killpg(run.pid, 0)
                return True
            except ProcessLookupError:
                return False
        leaked = group_live()
        if leaked:
            os.killpg(run.pid, signal.SIGTERM)
            deadline = time.monotonic() + 3
            while group_live() and time.monotonic() < deadline:
                time.sleep(0.05)
            if group_live():
                os.killpg(run.pid, signal.SIGKILL)
                time.sleep(0.05)
        retired = not group_live()
    result = {"name": name, "command": command, "exitCode": code,
              "seconds": round(time.monotonic() - start, 3), "log": f"{name}.log",
              "pid": run.pid, "timedOut": timed_out,
              "resourceLeakDetected": leaked, "processGroupRetired": retired}
    results.append(result)
    print(f"{name}: exit {code}", flush=True)
after = pins()
receipt = {"scope": "private fixtures and source typechecks only; no real disks or installed acceptance",
           "checks": results, "sourcePins": before, "sourceChangedDuringChecks": before != after,
           "passed": all(result["exitCode"] == 0 and not result["resourceLeakDetected"]
                         and result["processGroupRetired"] for result in results) and before == after}
(output / "checks.json").write_text(json.dumps(receipt, indent=2) + "\n")
raise SystemExit(0 if receipt["passed"] else 1)
