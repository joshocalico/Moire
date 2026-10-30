# networkControl: the session's MOIRE_NETWORK_CONTROL (docs/network-controls.md). "interactive"
# only lets Settings ask; NetworkManager still decides through Polkit, so an image passes it only
# with moire-network-services.nix's grant.
{ lib, pkgs, moire, networkControl ? "readonly" }:
assert lib.assertOneOf "networkControl" networkControl [ "readonly" "interactive" ];
moire.overrideAttrs (old: {
  pname = "moire-native-desktop";
  buildInputs = old.buildInputs ++ [ pkgs.seatd ];
  installPhase = old.installPhase + ''
    LD_LIBRARY_PATH=${lib.makeLibraryPath (old.buildInputs ++ [ pkgs.seatd ])} \
      $out/lib/moire/node_modules/.bin/tsx $out/lib/moire/apps/system/compositor/src/owned-apps.smoke.ts
    LD_LIBRARY_PATH=${lib.makeLibraryPath (old.buildInputs ++ [ pkgs.seatd ])} \
      $out/lib/moire/node_modules/.bin/tsx $out/lib/moire/packages/shell/src/logout.smoke.tsx
    LD_LIBRARY_PATH=${lib.makeLibraryPath (old.buildInputs ++ [ pkgs.seatd ])} \
      $out/lib/moire/node_modules/.bin/tsx $out/lib/moire/packages/sys/test/keyboard-state.native.smoke.ts
    # A flat frame (the lock screen) after retained ones reaches the EGL output. The build
    # sandbox has no render node, so this prints SKIP here; run it in a VM for pixels.
    LD_LIBRARY_PATH=${lib.makeLibraryPath (old.buildInputs ++ [ pkgs.seatd ])} \
      $out/lib/moire/node_modules/.bin/tsx $out/lib/moire/packages/sys/test/egl-flat-after-retained.native.smoke.ts
    # Keyboard & pointer prefs: multi-layout keymaps through real libxkbcommon, the seat and
    # client logic, and the layout catalog read from this image's xkeyboard-config.
    LD_LIBRARY_PATH=${lib.makeLibraryPath (old.buildInputs ++ [ pkgs.seatd ])} \
      $out/lib/moire/node_modules/.bin/tsx $out/lib/moire/packages/sys/test/keymap-layouts.native.smoke.ts
    # Touchpads: the multitouch decoder and gesture machines from synthetic and recorded event
    # streams, then the ioctl probe through this image's libc (no input devices in the build).
    for source in packages/sys/src/touchpad.smoke.ts packages/sys/test/touchpad.native.smoke.ts; do
      LD_LIBRARY_PATH=${lib.makeLibraryPath (old.buildInputs ++ [ pkgs.seatd ])} \
        $out/lib/moire/node_modules/.bin/tsx $out/lib/moire/$source
    done
    for source in packages/sys/src/pointer-config.smoke.ts \
      packages/core/src/seat-input.smoke.ts \
      packages/prefs/tests/input-settings.smoke.ts \
      packages/system-management/src/input-settings.smoke.ts \
      packages/system-management/src/keyboard-layouts.smoke.ts; do
      HOME=$TMPDIR MOIRE_REQUIRE_XKB_DATA=1 \
        MOIRE_XKB_CONFIG_ROOT=${pkgs.xkeyboard_config}/share/X11/xkb \
        LD_LIBRARY_PATH=${lib.makeLibraryPath (old.buildInputs ++ [ pkgs.seatd ])} \
        $out/lib/moire/node_modules/.bin/tsx $out/lib/moire/$source
    done
    LD_LIBRARY_PATH=${lib.makeLibraryPath (old.buildInputs ++ [ pkgs.seatd ])} \
      $out/lib/moire/node_modules/.bin/tsx $out/lib/moire/packages/core/test/files-interaction.native.smoke.tsx
    # Sound: the image's PipeWire shim loads with real libpipewire and passes the ring cases (no
    # daemon here), and the stream layer runs against the fake libpipewire built with this cc.
    MOIRE_REQUIRE_PWRING=1 MOIRE_PWRING_LIBRARY=$out/lib/libmoire-pwring.so \
      LD_LIBRARY_PATH=${lib.makeLibraryPath (old.buildInputs ++ [ pkgs.seatd ])} \
      $out/lib/moire/node_modules/.bin/tsx $out/lib/moire/packages/sys/src/pipewire-ring.native.smoke.ts
    CC=$CC $out/lib/moire/node_modules/.bin/tsx $out/lib/moire/packages/sys/src/pipewire-stream.smoke.ts
    for source in packages/audio/src/pod.smoke.ts packages/audio/src/control.smoke.ts \
      packages/audio/src/sound.smoke.ts; do
      HOME=$TMPDIR $out/lib/moire/node_modules/.bin/tsx $out/lib/moire/$source
    done
    # Settings backends: region formats and the panel clock, and the time/accounts clients.
    for source in packages/prefs/src/region.smoke.ts \
      packages/system-management/src/settings-clients.smoke.ts; do
      HOME=$TMPDIR $out/lib/moire/node_modules/.bin/tsx $out/lib/moire/$source
    done
    # The native session runs the precompiled compositor with plain Node; bin/moire
    # (tsx) stays for moire-session and source-path tooling such as input tracing.
    ${pkgs.nodejs_22}/bin/node ${../scripts/bundle-sessions.mjs} $out/lib/moire \
      $out/lib/moire/session-bundle desktop=apps/system/compositor/src/main.ts \
      wallpaper-worker=packages/theme/src/wallpaper-worker.ts
    makeWrapper ${pkgs.nodejs_22}/bin/node $out/bin/moire-native-desktop-direct \
      --add-flags "$out/lib/moire/session-bundle/desktop.mjs" \
      --set MOIRE_SESSION_BUNDLE $out/lib/moire/session-bundle \
      --set MOIRE_NATIVE_SESSION 1 --set LIBSEAT_BACKEND logind \
      --set MOIRE_UI_PLATFORM wayland --set MOIRE_XWAYLAND 0 \
      --set MOIRE_XKB_CONFIG_ROOT ${pkgs.xkeyboard_config}/share/X11/xkb \
      --set MOIRE_NETWORK_CONTROL ${networkControl} \
      --unset MOIRE_GREETER --unset GREETD_SOCK \
      --unset MOIRE_INPUT_FIXTURE_TRACE --unset MOIRE_SCROLL_TRACE \
      --prefix PATH : "$out/bin" \
      --prefix LD_LIBRARY_PATH : ${lib.makeLibraryPath (old.buildInputs ++ [ pkgs.seatd ])}
    # Exercise the installed bundle's imports (koffi included) without a session.
    set +e
    ${pkgs.coreutils}/bin/env -u XDG_RUNTIME_DIR \
      $out/bin/moire-native-desktop-direct > desktop-entry-check.log 2>&1
    desktopEntryStatus=$?
    set -e
    test "$desktopEntryStatus" = 1
    ${pkgs.gnugrep}/bin/grep -Fx 'Moire compositor 0.0.0' desktop-entry-check.log
    ${pkgs.gnugrep}/bin/grep -F 'A non-root authenticated runtime is required' desktop-entry-check.log
    # The installed session entry must not load the runtime TypeScript loader.
    if ${pkgs.gnugrep}/bin/grep -F tsx/dist/loader $out/bin/moire-native-desktop-direct; then exit 1; fi
    cat > $out/bin/moire-native-desktop-session <<EOF
    #!${pkgs.bash}/bin/bash
    set -euo pipefail
    export XDG_CURRENT_DESKTOP=Moire XDG_SESSION_DESKTOP=Moire XDG_SESSION_TYPE=wayland
    export WAYLAND_DISPLAY=wayland-1
    export PATH="\$HOME/.local/bin:$out/bin:\$PATH"
    export XDG_DATA_HOME="\$HOME/.local/share" XDG_CONFIG_HOME="\$HOME/.config"
    # The session bus finds the portal backend's service file, and xdg-desktop-portal its
    # moire.portal and moire-portals.conf, under this package's share (docs/portals.md).
    export XDG_DATA_DIRS="$out/share:\''${XDG_DATA_DIRS:-/run/current-system/sw/share:/usr/local/share:/usr/share}"
    source $out/lib/moire/apps/system/session/register-apps.sh
    register_moire_apps $out/lib/moire
    exec ${pkgs.dbus}/bin/dbus-run-session -- $out/bin/moire-native-desktop-direct
    EOF
    chmod +x $out/bin/moire-native-desktop-session
    makeWrapper ${pkgs.systemd}/bin/systemd-cat $out/bin/moire-native-desktop \
      --add-flags "--identifier=moire-native-desktop --priority=info --level-prefix=false -- $out/bin/moire-native-desktop-session" \
      --prefix PATH : ${lib.makeBinPath [ pkgs.coreutils pkgs.desktop-file-utils pkgs.xdg-utils ]}
  '';
})
