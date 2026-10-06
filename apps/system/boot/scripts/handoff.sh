#!/usr/bin/env bash
set -euo pipefail
# Admission checks never start the desktop or restore a VT.
[[ $# == 0 ]] || { echo 'Usage: moire-boot-handoff' >&2; exit 1; }
controller=${MOIRE_SYSTEMCTL:-systemctl}
cleanup=${MOIRE_BOOT_CLEANUP:?Supply installed MOIRE_BOOT_CLEANUP}
unit=${MOIRE_BOOT_UNIT:-moire-boot.service}
[[ "$unit" =~ ^[a-zA-Z0-9_.@-]+\.service$ ]] || { echo 'Invalid boot service name' >&2; exit 1; }
checkpoint=$("$controller" show "$unit" --property=InvocationID --value)
if [[ -z "$checkpoint" ]]; then
  # A collected unit has no identity. Obtain one only from authenticated
  # historical admission, or the distinct initialized never-attempted result.
  checkpoint=$(MOIRE_BOOT_UNIT="$unit" "$cleanup" --admission-check --checkpoint)
fi
[[ "$checkpoint" == not-invoked || "$checkpoint" =~ ^[0-9a-f]{32}$ ]] || {
  echo 'No authenticated boot handoff checkpoint' >&2; exit 1;
}
stop_status=0
"$controller" stop "$unit" || stop_status=$?
# This checker ignores our INVOCATION_ID, authenticates current-boot records,
# accepts legitimate GC only with historical proof, and reobserves the manager.
MOIRE_BOOT_UNIT="$unit" "$cleanup" --admission-check --expect "$checkpoint"
printf '[boot/handoff] verified checkpoint=%s stop_status=%s\n' "$checkpoint" "$stop_status"
# A separate mandatory RequiredBy/Before gate checks again in this start job.
"$controller" start moire-session.service
