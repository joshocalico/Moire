# moire-dm, bundled: four single-file entries (broker, front, worker, exec helper) built at image
# time so the root processes run plain Node with no tsx and no runtime TypeScript, plus the
# unprivileged automatic-login writer (moire-dm-settings). The build
# also runs every moire-dm smoke, including real Linux-PAM through the koffi binding.
# See docs/moire-dm.md.
{ lib, pkgs, moire }:
let
  node = pkgs.nodejs_22;
  loader = "apps/system/compositor/node_modules/tsx/dist/loader.mjs";
  runtimeLibraries = lib.makeLibraryPath [ pkgs.pam pkgs.systemd ];
  # Exits 0 iff stdin (from pam_exec expose_authtok) is the synthetic test password.
  checker = pkgs.writeScript "moire-dm-pam-checker" ''
    #!${pkgs.bash}/bin/sh
    pw=$(${pkgs.coreutils}/bin/tr -d '\000')
    [ "$pw" = "SYNTHETIC-native-pam-password" ]
  '';
  # V8 hardening for every moire-dm process; --jitless is verified with koffi (docs/moire-dm.md).
  # --jitless already disables WebAssembly; --no-expose-wasm states it, so V8 stops warning that
  # it overrode the default on every process start.
  nodeFlags = "--jitless --no-expose-wasm --disallow-code-generation-from-strings --disable-proto=throw";
in
moire.overrideAttrs (old: {
  pname = "moire-dm";
  buildInputs = old.buildInputs ++ [ pkgs.pam ];
  installPhase = ''
    runHook preInstall
    mkdir -p $out/lib/moire $out/bin
    cp -R . $out/lib/moire/
    find $out/lib/moire/node_modules/.pnpm/koffi@*/node_modules/koffi/build/koffi \
      -mindepth 1 -maxdepth 1 ! -name linux_arm64 -exec rm -rf {} +
    cd $out/lib/moire
    for smoke in protocol state conversation daemon autologin; do
      ${node}/bin/node --import ./${loader} apps/system/moire-dm/src/$smoke.smoke.ts
    done
    cd - >/dev/null
    bundle=$out/lib/moire/moire-dm-bundle
    ${node}/bin/node ${../scripts/bundle-sessions.mjs} $out/lib/moire $bundle \
      moire-dm=apps/system/moire-dm/src/main.ts \
      moire-dm-front=apps/system/moire-dm/src/front-entry.ts \
      moire-dm-worker=apps/system/moire-dm/src/worker-entry.ts \
      moire-dm-exec=apps/system/moire-dm/src/exec-entry.ts \
      moire-dm-settings=apps/system/moire-dm/src/settings-entry.ts \
      moire-dm-native-check=apps/system/moire-dm/src/pam.native.smoke.ts
    # Real Linux-PAM and sd-login through the bundled code, under the same V8 flags as the
    # installed broker (--jitless included).
    MOIRE_PAM_MODULES_DIR=${pkgs.pam}/lib/security MOIRE_PAM_CHECKER=${checker} \
    LD_LIBRARY_PATH=${runtimeLibraries} \
      ${node}/bin/node ${nodeFlags} $bundle/moire-dm-native-check.mjs | tee $TMPDIR/native.log
    # The native smoke prints SKIP when its inputs are missing; here that is a failure.
    if ${pkgs.gnugrep}/bin/grep -q '^SKIP' $TMPDIR/native.log; then exit 1; fi
    # No V8 flag warning on stderr (e.g. "disabling flag --expose_wasm due to conflicting flags").
    ${node}/bin/node ${nodeFlags} -e 0 2>$TMPDIR/flags.log
    if [ -s $TMPDIR/flags.log ]; then cat $TMPDIR/flags.log; exit 1; fi
    makeWrapper ${node}/bin/node $out/bin/moire-dm \
      --add-flags "${nodeFlags} $bundle/moire-dm.mjs" \
      --set MOIRE_DM_FRONT_ENTRY $bundle/moire-dm-front.mjs \
      --set MOIRE_DM_WORKER_ENTRY $bundle/moire-dm-worker.mjs \
      --set MOIRE_DM_EXEC_ENTRY $bundle/moire-dm-exec.mjs \
      --set LD_LIBRARY_PATH ${runtimeLibraries} \
      --unset NODE_OPTIONS
    makeWrapper ${node}/bin/node $out/bin/moire-dm-settings \
      --add-flags "${nodeFlags} $bundle/moire-dm-settings.mjs" \
      --unset NODE_OPTIONS
    # The installed entries must not load the runtime TypeScript loader.
    for entry in moire-dm moire-dm-settings; do
      if ${pkgs.gnugrep}/bin/grep -F tsx/dist/loader $out/bin/$entry; then exit 1; fi
    done
    runHook postInstall
  '';
})
