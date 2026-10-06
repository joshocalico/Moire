#!/usr/bin/env bash
# Run disposable workflows against this checkout or an installed package.
set -euo pipefail
ROOT="${MOIRE_TEST_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT"
LOADER="$ROOT/apps/system/compositor/node_modules/tsx/dist/loader.mjs"
[[ -f "$LOADER" ]] || { echo 'Install workspace dependencies before testing.' >&2; exit 1; }
run() { node --import "$LOADER" "$@"; }
for app in editor notes calculator characters dictionary help calendar clock colors weather screenshot disk-usage; do
  run "apps/bundled/$app/src/smoke.tsx"
done
for app in image-viewer music archive-manager document-viewer video-player font-viewer sound-recorder; do
  run "apps/bundled/$app/src/smoke.ts"
done
run apps/bundled/archive-manager/src/publication.smoke.ts
run apps/bundled/archive-manager/src/layout.smoke.tsx
run apps/bundled/weather/src/clear-saved.smoke.tsx
run apps/bundled/screenshot/src/document.smoke.ts
run apps/bundled/screenshot/src/lifecycle.smoke.tsx
run apps/bundled/screenshot/src/gesture.smoke.mjs
run apps/bundled/screenshot/src/input-trace.smoke.tsx
run apps/bundled/music/src/import.smoke.ts
run apps/bundled/font-viewer/src/workflow.smoke.tsx
run apps/bundled/clock/src/ring-workflow.smoke.tsx
run apps/bundled/calendar/src/close.smoke.tsx
run packages/app-tools/src/publication-cleanup.smoke.tsx
for app in calendar clock colors; do
  run packages/app-tools/src/persistence-process.smoke.mjs "$app"
  run packages/app-tools/src/persistence-window.smoke.mjs "$app"
done
run packages/app-tools/src/playback.smoke.ts
run packages/app-tools/src/player-workflow.smoke.tsx
if [[ "$(uname -s)" == Linux ]]; then
  MOIRE_TEST_REAL_MPV=1 run packages/app-tools/src/player-mpv.smoke.tsx
else
  echo '[media/mpv] real Linux decoding/EOF workflow required; host prerequisite remains unexecuted'
fi
run packages/app-tools/src/views.smoke.tsx
run packages/ui/src/smoke.tsx
run packages/ui/src/personalization.smoke.ts
run packages/ui/src/dialog-footer.smoke.tsx
run packages/ui/src/scroll-keyboard.smoke.tsx
run packages/sys/src/scroll-trace.smoke.ts
run packages/sys/src/input-fixture-trace.smoke.ts
run packages/sys/src/input-fixture-hooks.smoke.ts
run packages/sys/src/input-fixture-read-policy.smoke.ts
run packages/sys/src/input-read-boundary.smoke.ts
run packages/core/src/input-fixture-hooks.smoke.mjs
run packages/ui/src/platforms/wayland/input-observer.smoke.ts
run packages/ui/src/platforms/wayland/input-fixture-path.smoke.ts
run packages/ui/src/primary-focus.smoke.tsx
run packages/ui/src/tabs-titlebar.smoke.tsx
run packages/ui/src/platforms/wayland/window-role.smoke.ts
run apps/system/management-service/src/identity.smoke.ts
run packages/dbus/src/signals.smoke.ts
run packages/prefs/src/audio-status.smoke.ts
run apps/system/management-service/src/notifications.smoke.ts
run apps/system/management-service/src/desktop-controls.smoke.ts
run apps/system/management-service/src/network-manager.smoke.ts
run apps/system/management-service/src/upower-battery.smoke.ts
run apps/system/management-service/src/shutdown.smoke.ts
run packages/app-discovery/src/portal-client.smoke.ts
run apps/core/process-manager/src/smoke.tsx
run packages/shell/src/focus-smoke.ts
run packages/ui/src/slider-commit.smoke.tsx
run packages/ui/src/text-field-password.smoke.tsx
run packages/shell/src/volume-intent.smoke.ts
run packages/shell/src/QuickSettingsContent.smoke.tsx
run packages/shell/src/quick-settings-details.smoke.tsx
run packages/shell/src/notification-tray.smoke.tsx
run packages/shell/src/network-presentation.smoke.tsx
run packages/shell/src/network-details.smoke.tsx
run packages/shell/src/battery-status.smoke.tsx
run packages/shell/src/network-controller.smoke.tsx
run packages/shell/src/panel-status.smoke.tsx
run packages/shell/src/task-overflow.smoke.tsx
run packages/shell/src/quick-settings.smoke.tsx
run packages/shell/src/popup-frame.smoke.tsx
run packages/shell/src/smoke.ts
run apps/bundled/files/src/filesystem.smoke.ts
run apps/bundled/files/src/cut-clipboard.smoke.tsx
run apps/bundled/files/src/transfer-outcome.smoke.ts
run apps/bundled/files/src/transfer-outcome.ui.smoke.tsx
run apps/bundled/files/src/transfer-metadata.smoke.ts
run apps/bundled/files/src/transfer-design.smoke.tsx
run apps/bundled/files/src/transfer-dialog.smoke.tsx
run apps/bundled/files/src/activation.smoke.ts
run apps/bundled/files/src/places.smoke.ts
run apps/bundled/files/src/keyboard.smoke.tsx
node --import "$LOADER" apps/bundled/files/src/keyboard.smoke.tsx --list
run apps/bundled/files/src/tabs.smoke.tsx
run apps/bundled/files/src/inspector.smoke.tsx
run apps/bundled/files/src/uris.smoke.tsx
run apps/bundled/files/src/panes.smoke.tsx
run apps/bundled/files/src/timestamp.smoke.tsx
run packages/ui/src/widgets/files-adoption.smoke.tsx
run apps/bundled/notes/src/rich-document.smoke.tsx
run apps/bundled/notes/src/selection.smoke.tsx
run apps/bundled/notes/src/empty-state.smoke.tsx
run apps/bundled/music/src/navigation.smoke.tsx
run packages/ui/src/adaptive-panes.smoke.tsx
run packages/ui/src/collection-list.smoke.tsx
run packages/ui/src/playback-bar.smoke.tsx
run packages/ui/src/widgets/document-model.smoke.ts
run packages/ui/src/widgets/document-layout.smoke.ts
run packages/ui/src/document-editor.smoke.tsx
run packages/ui/src/intrinsic-content.smoke.tsx
run apps/bundled/sound-recorder/src/close-guard.smoke.tsx
run packages/ui/src/text-area.smoke.tsx
run packages/ui/src/text-field-batched.smoke.tsx
run packages/ui/src/window-frame.smoke.tsx
run packages/ui/src/fullscreen.smoke.tsx
run packages/ui/src/platforms/wayland/fullscreen-configure.smoke.ts
run packages/ui/src/backdrop/silk.smoke.ts
run packages/ui/src/backdrop/backdrop.smoke.tsx
run apps/system/greeter/src/smoke.tsx
run apps/system/greeter/src/motion.smoke.tsx
run packages/ui/src/retained-motion-admission.smoke.ts
run packages/prefs/tests/reduced-motion.smoke.ts
run packages/prefs/tests/consumers.smoke.tsx
run apps/system/boot/src/guardian.smoke.ts
run apps/system/boot/src/view.smoke.tsx
if [[ "$(uname -s)" == Linux ]]; then
  bash "${BASH_SOURCE[0]%/*}/test-session-handoff.sh"
else
  echo '[session/desktop] installed Linux disposable D-Bus check required'
fi
run packages/ui/src/icon-family.smoke.tsx
run packages/ui/src/icon-adoption.smoke.tsx
run packages/ui/scripts/integration-input.smoke.tsx
run packages/ui/scripts/settings-display.smoke.tsx
run packages/core/src/capture.smoke.ts
run packages/core/src/window-work-area.smoke.mjs
run packages/core/src/keyboard-focus.smoke.mjs
run apps/system/compositor/src/capture.smoke.ts
run packages/core/src/spawn.smoke.ts
if [[ -f apps/system/session/register-apps.smoke.sh ]]; then bash apps/system/session/register-apps.smoke.sh; fi
if [[ ! -f apps/system/session/register-apps.smoke.sh && -f packages/app-discovery/src/associations.smoke.ts ]]; then run packages/app-discovery/src/associations.smoke.ts; fi
