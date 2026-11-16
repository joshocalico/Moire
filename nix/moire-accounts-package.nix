# moire-accounts, bundled: the administrator-account mechanism (docs/polkit-agent.md, "One prompt
# per change") as one single-file entry, so the system service runs plain Node with no tsx and
# no runtime TypeScript. The build runs its smoke first (a private dbus-daemon stands in for the
# system bus, polkit, AccountsService and the compositor).
{ lib, pkgs, moire }:
let
  node = pkgs.nodejs_22;
  loader = "apps/system/compositor/node_modules/tsx/dist/loader.mjs";
  # The same V8 hardening as moire-dm-settings (nix/moire-dm-package.nix).
  nodeFlags = "--jitless --no-expose-wasm --disallow-code-generation-from-strings --disable-proto=throw";
in
moire.overrideAttrs (old: {
  pname = "moire-accounts";
  nativeBuildInputs = (old.nativeBuildInputs or [ ]) ++ [ pkgs.dbus ];
  installPhase = ''
    runHook preInstall
    mkdir -p $out/lib/moire $out/bin
    cp -R . $out/lib/moire/
    # Only this platform's koffi build: the others can't be patched against Nix libraries.
    find $out/lib/moire/node_modules/.pnpm/koffi@*/node_modules/koffi/build/koffi \
      -mindepth 1 -maxdepth 1 ! -name linux_arm64 -exec rm -rf {} +
    cd $out/lib/moire
    # The sandbox has no /etc/dbus-1, so name the session config from the store.
    MOIRE_TEST_DBUS_DAEMON=${pkgs.dbus}/bin/dbus-daemon \
    MOIRE_TEST_DBUS_CONFIG=${pkgs.dbus}/share/dbus-1/session.conf \
      ${node}/bin/node --import ./${loader} apps/system/management-service/src/account-admin.smoke.ts
    cd - >/dev/null
    bundle=$out/lib/moire/moire-accounts-bundle
    ${node}/bin/node ${../scripts/bundle-sessions.mjs} $out/lib/moire $bundle \
      moire-accounts=apps/system/management-service/src/account-admin-entry.ts
    makeWrapper ${node}/bin/node $out/bin/moire-accounts \
      --add-flags "${nodeFlags} $bundle/moire-accounts.mjs" \
      --unset NODE_OPTIONS
    # The installed entry must not load the runtime TypeScript loader.
    if ${pkgs.gnugrep}/bin/grep -F tsx/dist/loader $out/bin/moire-accounts; then exit 1; fi
    runHook postInstall
  '';
})
