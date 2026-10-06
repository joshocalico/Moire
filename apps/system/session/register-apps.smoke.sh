#!/usr/bin/env bash
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/moire-registration.XXXXXXXX")"
trap 'rm -rf "$fixture"' EXIT
fixture_root="$fixture/project with spaces"
fixture_home="$fixture/home with spaces"
mkdir -p "$fixture_root/apps/core/memory-pressure" "$fixture_home/.local/bin" "$fixture/config" "$fixture/data/applications" "$fixture/stubs" "$fixture/system-data" "$fixture/system-config"

# Copy registrations and link the actual executables, without starting any app.
count=0
for entry in "$repo"/apps/{bundled,core,developer}/*/*.desktop; do
  [[ -f "$entry" ]] || continue
  relative="${entry#"$repo/"}"
  target="$fixture_root/$relative"
  launcher="$(basename "$entry" .desktop)"
  [[ -x "$(dirname "$entry")/$launcher" ]] || {
    printf 'Missing executable for %s\n' "$entry" >&2
    exit 1
  }
  mkdir -p "$(dirname "$target")"
  cp "$entry" "$target"
  ln -s "$(dirname "$entry")/$launcher" "$(dirname "$target")/$launcher"
  count=$((count + 1))
done
[[ "$count" -ge 25 ]]
mkdir -p "$fixture_root/packages/ui/icons"
cp "$repo"/packages/ui/icons/*.svg "$fixture_root/packages/ui/icons/"
[[ -x "$repo/apps/core/memory-pressure/moire-memory-pressure" ]]
ln -s "$repo/apps/core/memory-pressure/moire-memory-pressure" "$fixture_root/apps/core/memory-pressure/moire-memory-pressure"
mkdir -p "$fixture_root/apps/bundled/unavailable"
printf '[Desktop Entry]\nType=Application\nName=Unavailable\nExec=moire-unavailable\n' > "$fixture_root/apps/bundled/unavailable/moire-unavailable.desktop"
printf 'text/plain\tuser-editor.desktop\n' > "$fixture/mime-state"
printf '[Desktop Entry]\nType=Application\nName=Existing editor\nExec=user-editor %%f\nMimeType=text/plain;\n' > "$fixture/data/applications/user-editor.desktop"
printf '[Default Applications]\ntext/plain=user-editor.desktop;\n' > "$fixture/config/mimeapps.list"

cat > "$fixture/stubs/xdg-mime" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
case "$1 $2" in
  'query default') awk -F '\t' -v mime="$3" '$1 == mime { print $2; exit }' "$MOIRE_MIME_STATE" ;;
  default*)
    printf '%s\t%s\n' "$3" "$2" >> "$MOIRE_MIME_STATE"
    { printf '[Default Applications]\n'; awk -F '\t' '{ print $1 "=" $2 ";" }' "$MOIRE_MIME_STATE"; } > "$XDG_CONFIG_HOME/mimeapps.list"
    ;;
  *) exit 2 ;;
esac
STUB
cat > "$fixture/stubs/update-desktop-database" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$1" >> "$MOIRE_UPDATE_LOG"
STUB
chmod +x "$fixture/stubs/xdg-mime" "$fixture/stubs/update-desktop-database"

# All subprocess user directories and utility writes stay inside this fixture.
env HOME="$fixture_home" XDG_DATA_HOME="$fixture/data" XDG_DATA_DIRS="$fixture/system-data" XDG_CONFIG_HOME="$fixture/config" XDG_CONFIG_DIRS="$fixture/system-config" XDG_CURRENT_DESKTOP=Moire PATH="$fixture/stubs:$fixture_home/.local/bin:$PATH" MOIRE_MIME_STATE="$fixture/mime-state" MOIRE_UPDATE_LOG="$fixture/update-log" \
  bash -c 'source "$1/apps/system/session/register-apps.sh"; register_moire_apps "$2"; cp "$MOIRE_MIME_STATE" "$MOIRE_MIME_STATE.first"; register_moire_apps "$2"; cmp "$MOIRE_MIME_STATE" "$MOIRE_MIME_STATE.first"' smoke "$repo" "$fixture_root"

for entry in "$fixture_root"/apps/{bundled,core,developer}/*/*.desktop; do
  launcher="$(basename "$entry" .desktop)"
  [[ "$launcher" == moire-unavailable ]] && continue
  cmp "$entry" "$fixture/data/applications/$launcher.desktop"
  [[ -x "$fixture_home/.local/bin/$launcher" ]]
  [[ "$(readlink "$fixture_home/.local/bin/$launcher")" == "$(dirname "$entry")/$launcher" ]]
done
[[ ! -e "$fixture/data/applications/moire-unavailable.desktop" ]]
for entry in "$fixture_root"/packages/ui/icons/*.svg; do
  cmp "$entry" "$fixture/data/icons/hicolor/scalable/apps/moire-$(basename "$entry")"
done
[[ "$(wc -l < "$fixture/mime-state" | tr -d ' ')" -ge 32 ]]
awk -F '\t' 'seen[$1]++ { exit 1 }' "$fixture/mime-state"
[[ "$(wc -l < "$fixture/update-log" | tr -d ' ')" == 2 ]]
[[ "$(head -n 1 "$fixture/update-log")" == "$fixture/data/applications" ]]

env HOME="$fixture_home" XDG_DATA_HOME="$fixture/data" XDG_DATA_DIRS="$fixture/system-data" XDG_CONFIG_HOME="$fixture/config" XDG_CONFIG_DIRS="$fixture/system-config" XDG_CURRENT_DESKTOP=Moire PATH="$fixture/stubs:$fixture_home/.local/bin:$PATH" MOIRE_ASSOC_FIXTURE="$fixture" \
  "$repo/node_modules/.bin/tsx" "$repo/packages/app-discovery/src/associations.smoke.ts" --registered "$fixture_root"
printf '[session/register-apps-smoke] %s actual launchers, isolated MIME choices and repeat registration passed\n' "$count"
