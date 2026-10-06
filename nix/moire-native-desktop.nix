{ lib, pkgs, moire }:
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
    LD_LIBRARY_PATH=${lib.makeLibraryPath (old.buildInputs ++ [ pkgs.seatd ])} \
      $out/lib/moire/node_modules/.bin/tsx $out/lib/moire/packages/core/test/files-interaction.native.smoke.tsx
    makeWrapper $out/bin/moire $out/bin/moire-native-desktop-direct \
      --set MOIRE_NATIVE_SESSION 1 --set LIBSEAT_BACKEND logind \
      --set MOIRE_UI_PLATFORM wayland --set MOIRE_XWAYLAND 0 \
      --unset MOIRE_GREETER --unset GREETD_SOCK \
      --unset MOIRE_INPUT_FIXTURE_TRACE --unset MOIRE_SCROLL_TRACE \
      --prefix PATH : "$out/bin" \
      --prefix LD_LIBRARY_PATH : ${lib.makeLibraryPath (old.buildInputs ++ [ pkgs.seatd ])}
    cat > $out/bin/moire-native-desktop-session <<EOF
    #!${pkgs.bash}/bin/bash
    set -euo pipefail
    export XDG_CURRENT_DESKTOP=Moire XDG_SESSION_DESKTOP=Moire XDG_SESSION_TYPE=wayland
    export WAYLAND_DISPLAY=wayland-1
    export PATH="\$HOME/.local/bin:$out/bin:\$PATH"
    export XDG_DATA_HOME="\$HOME/.local/share" XDG_CONFIG_HOME="\$HOME/.config"
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
