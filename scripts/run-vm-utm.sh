#!/usr/bin/env bash
# UTM's documented local URL action; register the generated bundle once first.
set -euo pipefail
[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || {
  echo "This launcher requires Apple Silicon macOS." >&2
  exit 1
}
exec open -a UTM 'utm://start?name=Moire%20VirGL%20Accelerated'
