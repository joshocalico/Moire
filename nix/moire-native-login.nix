{ lib, pkgs, moire, sessionExecutable, sessionLabel ? "Moire session probe", discoverUsers ? false }:
moire.overrideAttrs (old: {
  pname = "moire-native-login";
  buildInputs = old.buildInputs ++ [ pkgs.seatd ];
  installPhase = ''
    runHook preInstall
    mkdir -p $out/lib/moire $out/bin
    cp -R . $out/lib/moire/
    mkdir -p $out/lib/moire/scripts
    cp ${../scripts/keymap-client.native.smoke.ts} $out/lib/moire/scripts/keymap-client.native.smoke.ts
    find $out/lib/moire/node_modules/.pnpm/koffi@*/node_modules/koffi/build/koffi \
      -mindepth 1 -maxdepth 1 ! -name linux_arm64 -exec rm -rf {} +
    cat > $out/lib/moire/native-login-entry.mts <<EOF
    import { runPreLogin } from './apps/system/compositor/src/pre-login';
    try { process.exit(await runPreLogin('${sessionExecutable}', '${sessionLabel}', ${if discoverUsers then "true" else "false"})); }
    catch { console.error('Moire pre-login failed.'); process.exit(1); }
    EOF
    makeWrapper ${pkgs.nodejs_22}/bin/node $out/bin/moire-native-login-direct \
      --add-flags "--import $out/lib/moire/apps/system/compositor/node_modules/tsx/dist/loader.mjs $out/lib/moire/native-login-entry.mts" \
      --set LIBSEAT_BACKEND logind \
      --set MOIRE_OUTPUT_PIPELINE_TRACE 1 \
      --unset MOIRE_INPUT_FIXTURE_TRACE --unset MOIRE_SCROLL_TRACE \
      --prefix PATH : ${lib.makeBinPath [ pkgs.systemd pkgs.coreutils ]} \
      --prefix LD_LIBRARY_PATH : ${lib.makeLibraryPath (old.buildInputs ++ [ pkgs.seatd ])}
    makeWrapper ${pkgs.systemd}/bin/systemd-cat $out/bin/moire-native-login \
      --add-flags "--identifier=moire-native-login --priority=info --level-prefix=false -- $out/bin/moire-native-login-direct"
    # Exercise the installed loader/imports without a greetd runtime or any device access.
    set +e
    ${pkgs.coreutils}/bin/env -u XDG_RUNTIME_DIR -u GREETD_SOCK \
      $out/bin/moire-native-login-direct > entry-check.log 2>&1
    entryStatus=$?
    set -e
    test "$entryStatus" = 1
    ${pkgs.gnugrep}/bin/grep -Fx 'Moire pre-login failed.' entry-check.log
    UV_THREADPOOL_SIZE=4 LD_LIBRARY_PATH=${lib.makeLibraryPath (old.buildInputs ++ [ pkgs.seatd ])} \
      ${pkgs.nodejs_22}/bin/node \
      --import $out/lib/moire/apps/system/compositor/node_modules/tsx/dist/loader.mjs \
      $out/lib/moire/packages/sys/src/readiness.native.smoke.ts
    UV_THREADPOOL_SIZE=4 LD_LIBRARY_PATH=${lib.makeLibraryPath (old.buildInputs ++ [ pkgs.seatd ])} \
      ${pkgs.nodejs_22}/bin/node \
      --import $out/lib/moire/apps/system/compositor/node_modules/tsx/dist/loader.mjs \
      $out/lib/moire/packages/core/src/login-liveness.native.smoke.tsx
    UV_THREADPOOL_SIZE=4 LD_LIBRARY_PATH=${lib.makeLibraryPath (old.buildInputs ++ [ pkgs.seatd ])} \
      ${pkgs.nodejs_22}/bin/node \
      --import $out/lib/moire/apps/system/compositor/node_modules/tsx/dist/loader.mjs \
      $out/lib/moire/packages/core/src/surface-frame-commit.smoke.ts
    UV_THREADPOOL_SIZE=4 LD_LIBRARY_PATH=${lib.makeLibraryPath (old.buildInputs ++ [ pkgs.seatd ])} \
      ${pkgs.nodejs_22}/bin/node \
      --import $out/lib/moire/apps/system/compositor/node_modules/tsx/dist/loader.mjs \
      $out/lib/moire/packages/ui/src/skipped-raster.smoke.tsx
    for source in packages/ui/src/retained-motion-admission.smoke.ts \
      packages/ui/src/platforms/wayland/rendering.smoke.ts \
      apps/system/greeter/src/native/wave.smoke.tsx \
      apps/system/greeter/src/native/user-picker.smoke.tsx \
      apps/system/display-manager/src/native-greetd-client.smoke.ts; do
      UV_THREADPOOL_SIZE=4 MOIRE_UI_PLATFORM=headless MOIRE_UI_ACCELERATION=software \
        PATH=${lib.makeBinPath [ pkgs.ffmpeg pkgs.coreutils ]}:$PATH \
        LD_LIBRARY_PATH=${lib.makeLibraryPath (old.buildInputs ++ [ pkgs.seatd ])} \
        ${pkgs.nodejs_22}/bin/node \
        --import $out/lib/moire/apps/system/compositor/node_modules/tsx/dist/loader.mjs \
        $out/lib/moire/$source
    done
    PATH=${lib.makeBinPath [ pkgs.dbus pkgs.coreutils ]}:$PATH \
      ${pkgs.nodejs_22}/bin/node \
      --import $out/lib/moire/apps/system/compositor/node_modules/tsx/dist/loader.mjs \
      $out/lib/moire/apps/system/compositor/src/local-users.smoke.ts
    for spec in 'keymap-fd:packages/ui/src/platforms/wayland/keymap-fd.smoke.ts' \
      'xkb:packages/ui/src/platforms/wayland/xkb.smoke.ts' \
      'keymap-client:scripts/keymap-client.native.smoke.ts'; do
      name="''${spec%%:*}"
      source="''${spec#*:}"
      makeWrapper ${pkgs.nodejs_22}/bin/node $out/bin/moire-native-check-$name \
        --add-flags "--import $out/lib/moire/apps/system/compositor/node_modules/tsx/dist/loader.mjs $out/lib/moire/$source" \
        --prefix LD_LIBRARY_PATH : ${lib.makeLibraryPath old.buildInputs}
    done
    runHook postInstall
  '';
})
