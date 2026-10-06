{ lib, stdenv, nodejs_22, pnpm, pnpmConfigHook, fetchPnpmDeps, autoPatchelfHook, makeWrapper,
  bash, coreutils, findutils, gnugrep, gnused, dbus, desktop-file-utils,
  xdg-utils, xwayland, libdrm, libgbm, libglvnd, libxkbcommon, systemd, ffmpeg, mpv, poppler-utils, libarchive, fontconfig, pipewire, shared-mime-info }:

let
  # Include runtime source and assets, never host dependencies or VM images.
  src = lib.cleanSourceWith {
    src = ../.;
    filter = path: type:
      let
        name = baseNameOf path;
        root = toString ../.;
        top = builtins.head (lib.splitString "/" (lib.removePrefix "${root}/" path));
      in (path == root || builtins.elem top [
        "apps" "packages" "themes" "docs" "package.json" "pnpm-lock.yaml"
        "pnpm-workspace.yaml" ".npmrc" "tsconfig.json" "tsconfig.base.json"
      ]) && !(builtins.elem name [
        ".git" "node_modules" "dist" "verification" "vm" "result" ".pnpm-store"
        ".cursor" ".DS_Store" "__pycache__"
      ]) && !(lib.hasSuffix ".tsbuildinfo" name)
        && !(lib.hasSuffix ".log" name)
        && !(lib.hasSuffix ".pyc" name)
        && name != ".env" && !(lib.hasPrefix ".env." name);
  };
  runtime = [ nodejs_22 bash coreutils findutils gnugrep gnused dbus
    desktop-file-utils xdg-utils xwayland ffmpeg mpv poppler-utils libarchive fontconfig pipewire shared-mime-info ];
  ffiLibraries = [ libdrm libgbm libglvnd libxkbcommon systemd stdenv.cc.cc.lib ];
in stdenv.mkDerivation (finalAttrs: {
  pname = "moire";
  version = "0.0.0";
  inherit src;

  nativeBuildInputs = [ nodejs_22 pnpm pnpmConfigHook autoPatchelfHook makeWrapper ];
  buildInputs = ffiLibraries;
  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    fetcherVersion = 4;
    hash = "sha256-C6dUQb5uVeO8XXnryEpaThd1quJT1cx2qo5H3gaF3wU=";
  };

  # Workspace exports and launchers point at TypeScript sources and use tsx.
  # The offline install includes Linux ARM64 koffi/esbuild prebuilt binaries.
  dontBuild = true;
  installPhase = ''
    runHook preInstall
    mkdir -p $out/lib/moire $out/bin
    cp -R . $out/lib/moire/
    # koffi ships binaries for several operating systems in one tarball.
    # Keep only the guest's glibc ARM64 binary before autoPatchelf runs.
    find $out/lib/moire/node_modules/.pnpm/koffi@*/node_modules/koffi/build/koffi \
      -mindepth 1 -maxdepth 1 ! -name linux_arm64 -exec rm -rf {} +
    patchShebangs $out/lib/moire/apps
    # Workspace launchers expect a root-level tsx entry point. pnpm 11 does
    # not hoist workspace-only executables there, so install it explicitly.
    # Load TypeScript in the app process. The tsx CLI forks a preflight child
    # that intercepts SIGTERM and can prevent System Monitor Quit from exiting.
    makeWrapper ${nodejs_22}/bin/node $out/lib/moire/node_modules/.bin/tsx \
      --add-flags "--import $out/lib/moire/apps/system/compositor/node_modules/tsx/dist/loader.mjs"
    # The development session uses pnpm; installed sessions run tsx directly.
    makeWrapper $out/lib/moire/node_modules/.bin/tsx $out/bin/moire \
      --add-flags "$out/lib/moire/apps/system/compositor/src/main.ts"
    makeWrapper $out/lib/moire/node_modules/.bin/tsx $out/bin/moire-management \
      --add-flags "$out/lib/moire/apps/system/management-service/src/main.ts"
    makeWrapper $out/lib/moire/node_modules/.bin/tsx $out/bin/moire-welcome \
      --add-flags "$out/lib/moire/apps/system/session/src/welcome.ts"
    makeWrapper $out/lib/moire/node_modules/.bin/tsx $out/bin/moire-start-desktop \
      --add-flags "$out/lib/moire/apps/system/session/src/start-desktop.ts"
    # Disposable stage-2 native verification entry. This full desktop package
    # is deliberately not added to initrd; the narrow boot closure is a later gate.
    mkdir -p $out/share/moire-boot
    LD_LIBRARY_PATH=${lib.makeLibraryPath ffiLibraries} \
      $out/lib/moire/node_modules/.bin/tsx \
      $out/lib/moire/apps/system/boot/src/generate-assets.ts \
      $out/share/moire-boot/silk-fold.rgba
    makeWrapper $out/lib/moire/node_modules/.bin/tsx $out/bin/moire-boot-stage \
      --add-flags "$out/lib/moire/apps/system/boot/src/main.ts" \
      --set MOIRE_BOOT_RENDERER "$out/lib/moire/apps/system/boot/src/renderer.tsx" \
      --set MOIRE_BOOT_ARTWORK "$out/share/moire-boot/silk-fold.rgba" \
      --prefix PATH : ${lib.makeBinPath runtime} \
      --prefix LD_LIBRARY_PATH : ${lib.makeLibraryPath ffiLibraries}
    substituteInPlace $out/lib/moire/apps/system/session/moire-session \
      --replace-fail 'pnpm --filter @moire/system-management-service start' "$out/bin/moire-management" \
      --replace-fail 'pnpm --filter @moire/terminal-app start' "$out/lib/moire/apps/bundled/terminal/moire-terminal" \
      --replace-fail 'pnpm --filter @moire/files start' "$out/lib/moire/apps/bundled/files/moire-files"
    substituteInPlace $out/lib/moire/apps/system/session/moire-session \
      --replace-fail 'pnpm --filter @moire/session welcome' "$out/bin/moire-welcome" \
      --replace-fail 'pnpm --filter @moire/session start-desktop' "$out/bin/moire-start-desktop"
    makeWrapper $out/lib/moire/apps/system/session/moire-session $out/bin/moire-session \
      --set MOIRE_COMPOSITOR "$out/bin/moire" \
      --prefix PATH : ${lib.makeBinPath runtime} \
      --prefix XDG_DATA_DIRS : ${shared-mime-info}/share \
      --prefix LD_LIBRARY_PATH : ${lib.makeLibraryPath ffiLibraries}
    runHook postInstall
  '';

  meta = {
    description = "Moire Wayland desktop session";
    platforms = [ "aarch64-linux" ];
  };
})
