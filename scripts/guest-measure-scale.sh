#!/usr/bin/env bash
set -euo pipefail
cd /home/moire/moire/packages/ui
runuser -u moire -- env HOME=/home/moire pnpm exec tsx <<'EOF'
import { installUiFonts, setUiScaleFactor, getUiScaleFactor } from "./src/font/index.ts";
import { getTextRenderer } from "@moire/react-host";
await installUiFonts();
setUiScaleFactor(1);
const t = getTextRenderer()!;
const a = t.measure("Settings", { fontSize: 22 });
setUiScaleFactor(1.5);
const b = t.measure("Settings", { fontSize: 22 });
console.log(JSON.stringify({ scale: getUiScaleFactor(), at1: a, at15: b }));
EOF
