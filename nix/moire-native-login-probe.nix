{ config, lib, pkgs, moire, ... }:
let
  sessions = builtins.filter (package: (package.pname or "") == "moire-pam-test-session") config.environment.systemPackages;
  session = assert builtins.length sessions == 1; builtins.head sessions;
  greeter = import ./moire-native-login.nix {
    inherit lib pkgs moire;
    sessionExecutable = "${session}/bin/moire-authenticated-session";
  };
  checks = pkgs.writeShellScript "moire-native-keymap-checks" ''
    set -eu
    ${pkgs.coreutils}/bin/cat /etc/moire-build.json
    echo
    ${greeter}/bin/moire-native-check-keymap-fd
    ${greeter}/bin/moire-native-check-xkb
    ${greeter}/bin/moire-native-check-keymap-client
    echo 'MOIRE_NATIVE_KEYMAP_CHECKS=passed'
  '';
in {
  # The preserved C58 module already forces its own historical image name at priority 50.
  image.baseName = lib.mkOverride 40 "moire-aarch64-native-login-probe";
  isoImage.volumeID = lib.mkForce "MOIRE_NATIVE_LOGIN";
  hardware.graphics.enable = true;
  environment.etc."moire-build.json".text = builtins.toJSON {
    milestone = "c62-native-login-probe";
    desktopAcceptance = false;
    sources = builtins.listToAttrs (map (name: {
      inherit name;
      value = builtins.hashFile "sha256" (../. + "/${name}");
    }) [
      "apps/system/compositor/src/pre-login.ts"
      "packages/core/src/server.ts"
      "packages/sys/src/seat.ts"
      "packages/sys/src/readiness.ts"
      "packages/sys/src/readiness.native.smoke.ts"
      "packages/sys/src/keymap.ts"
      "packages/ui/package.json"
      "packages/ui/src/platforms/wayland/index.ts"
      "packages/core/src/login-liveness.native.smoke.tsx"
      "packages/core/src/surface-frame-commit.smoke.ts"
      "packages/core/src/output-pipeline-trace.ts"
      "packages/core/src/output-renderer.ts"
      "packages/ui/src/window.ts"
      "packages/ui/src/skipped-raster.smoke.tsx"
      "packages/react-host/src/index.ts"
      "package.json"
      "nix/moire-native-login.nix"
      "nix/moire-native-login-probe.nix"
      "nix/moire-native-login-probe-image.nix"
      "pnpm-lock.yaml"
      "flake.lock"
    ]);
  };
  services.greetd.useTextGreeter = lib.mkForce false;
  services.greetd.settings.default_session.command = lib.mkForce "${greeter}/bin/moire-native-login";
  systemd.services.moire-native-keymap-checks = {
    wantedBy = [ "multi-user.target" ];
    before = [ "greetd.service" ];
    serviceConfig = {
      Type = "oneshot";
      User = "moire-pam-test";
      ExecStart = checks;
      StandardOutput = "journal";
      StandardError = "journal";
    };
  };
  systemd.services.greetd = {
    requires = [ "moire-native-keymap-checks.service" ];
    after = [ "moire-native-keymap-checks.service" ];
  };
}
