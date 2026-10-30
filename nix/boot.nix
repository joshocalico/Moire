{ lib, stdenv, nodejs_22, nodejs-slim_22, pnpm, pnpmConfigHook, autoPatchelfHook, makeWrapper,
  libdrm, libgbm, libglvnd, pnpmDeps }:

let
  src = lib.cleanSourceWith {
    src = ../.;
    filter = path: type:
      let
        name = baseNameOf path;
        root = toString ../.;
        top = builtins.head (lib.splitString "/" (lib.removePrefix "${root}/" path));
      in (path == root || builtins.elem top [
        "apps" "packages" "themes" "package.json" "pnpm-lock.yaml"
        "pnpm-workspace.yaml" ".npmrc" "tsconfig.json" "tsconfig.base.json"
      ]) && !(builtins.elem name [
        ".git" "node_modules" "dist" "verification" "vm" "result" ".pnpm-store"
        ".cursor" ".DS_Store" "__pycache__"
      ]) && !(lib.hasSuffix ".tsbuildinfo" name)
        && !(lib.hasSuffix ".log" name)
        && !(lib.hasSuffix ".pyc" name)
        && name != ".env" && !(lib.hasPrefix ".env." name);
  };
  # GBM/EGL/GLES (through glvnd → /run/opengl-driver) drive the animated scene.
  ffiLibraries = [ libdrm libgbm libglvnd stdenv.cc.cc.lib ];
  # pnpm/npm are build-only. The cached standalone Node output runs the bundle.
  runtimeNode = nodejs-slim_22;
in stdenv.mkDerivation {
  pname = "moire-boot";
  version = "0.0.0";
  inherit src pnpmDeps;
  nativeBuildInputs = [ nodejs_22 pnpm pnpmConfigHook autoPatchelfHook makeWrapper ];
  buildInputs = ffiLibraries;
  dontBuild = true;

  installPhase = ''
    runHook preInstall
    node apps/system/boot/scripts/bundle-boot.mjs "$PWD" "$out/lib/moire-boot"
    mkdir -p $out/share/moire-boot $out/bin
    LD_LIBRARY_PATH=${lib.makeLibraryPath ffiLibraries} \
      node $out/lib/moire-boot/src/entry/generate-assets.mjs \
      $out/share/moire-boot/silk-fold.rgba
    makeWrapper ${runtimeNode}/bin/node $out/bin/moire-boot \
      --add-flags "$out/lib/moire-boot/src/entry/guardian.mjs" \
      --set MOIRE_BOOT_RENDERER "$out/lib/moire-boot/src/entry/renderer.mjs" \
      --set MOIRE_BOOT_ARTWORK "$out/share/moire-boot/silk-fold.rgba" \
      --prefix LD_LIBRARY_PATH : ${lib.makeLibraryPath ffiLibraries}
    # Standalone animated stage run directly by systemd; hands the display to the compositor.
    makeWrapper ${runtimeNode}/bin/node $out/bin/moire-boot-stage \
      --add-flags "$out/lib/moire-boot/src/entry/renderer.mjs" \
      --set MOIRE_BOOT_STANDALONE 1 \
      --set MOIRE_BOOT_ARTWORK "$out/share/moire-boot/silk-fold.rgba" \
      --prefix LD_LIBRARY_PATH : ${lib.makeLibraryPath ffiLibraries}
    makeWrapper ${runtimeNode}/bin/node $out/bin/moire-boot-smoke \
      --add-flags "$out/lib/moire-boot/src/entry/guardian-smoke.mjs"
    makeWrapper ${runtimeNode}/bin/node $out/bin/moire-boot-cleanup \
      --add-flags "$out/lib/moire-boot/src/entry/cleanup.mjs" \
      --prefix LD_LIBRARY_PATH : ${lib.makeLibraryPath ffiLibraries}
    makeWrapper ${runtimeNode}/bin/node $out/bin/moire-initial-startup \
      --add-flags "$out/lib/moire-boot/src/entry/initial-startup.mjs"
    for entry in initial-startup console-latch desktop-admission renderer-environment systemd-notify; do
      makeWrapper ${runtimeNode}/bin/node "$out/bin/moire-boot-$entry-smoke" \
        --add-flags "$out/lib/moire-boot/src/entry/$entry-smoke.mjs" \
        --prefix LD_LIBRARY_PATH : ${lib.makeLibraryPath ffiLibraries}
    done
    makeWrapper ${runtimeNode}/bin/node $out/bin/moire-boot-managed-smoke \
      --add-flags "$out/lib/moire-boot/src/entry/managed-guardian-smoke.mjs"
    makeWrapper ${runtimeNode}/bin/node $out/bin/moire-boot-service-smoke \
      --add-flags "$out/lib/moire-boot/src/entry/service-cleanup-smoke.mjs"
    makeWrapper ${runtimeNode}/bin/node $out/bin/moire-boot-renderer-lifetime-smoke \
      --add-flags "$out/lib/moire-boot/src/entry/renderer-lifetime-smoke.mjs"
    makeWrapper ${runtimeNode}/bin/node $out/bin/moire-boot-admission-smoke \
      --add-flags "$out/lib/moire-boot/src/entry/release-admission-smoke.mjs"
    makeWrapper ${runtimeNode}/bin/node $out/bin/moire-boot-manager-smoke \
      --add-flags "$out/lib/moire-boot/src/entry/manager-observation-smoke.mjs"
    makeWrapper ${runtimeNode}/bin/node $out/bin/moire-boot-cleanup-cli-smoke \
      --add-flags "$out/lib/moire-boot/src/entry/cleanup-cli-smoke.mjs"
    makeWrapper ${runtimeNode}/bin/node $out/bin/moire-boot-view-smoke \
      --add-flags "$out/lib/moire-boot/src/entry/view-smoke.mjs" \
      --prefix LD_LIBRARY_PATH : ${lib.makeLibraryPath ffiLibraries}
    runHook postInstall
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    node apps/system/boot/scripts/smoke-installed.mjs "$out"
    runHook postInstallCheck
  '';
  meta = {
    description = "Precompiled Moire React boot stage (animated GLES scene, static fallback)";
    platforms = [ "aarch64-linux" ];
  };
}
