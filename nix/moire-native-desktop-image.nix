let
  base = builtins.getFlake ("path:" + toString ../.);
  system = "aarch64-linux";
  pkgs = import base.inputs.nixpkgs { inherit system; };
  moire = pkgs.callPackage ./moire.nix {};
  desktop = import ./moire-native-desktop.nix { inherit pkgs moire; inherit (pkgs) lib; };
  machine = base.inputs.nixpkgs.lib.nixosSystem {
    inherit system;
    specialArgs = { inherit moire; };
    modules = [ ./moire-pam-test.nix ./moire-native-login-probe.nix ({ lib, ... }: {
      image.baseName = lib.mkOverride 30 "moire-aarch64-native-desktop";
      isoImage.volumeID = lib.mkOverride 40 "MOIRE_NATIVE_DESK";
      environment.systemPackages = [ desktop ];
      # Explicitly authorized isolated guest metadata service; PAM remains greetd-owned.
      services.accounts-daemon.enable = true;
      services.greetd.settings.default_session.command = lib.mkOverride 40 (
        let greeter = import ./moire-native-login.nix {
          inherit pkgs moire lib;
          sessionExecutable = "${desktop}/bin/moire-native-desktop";
          sessionLabel = "Moire desktop · C63 R10";
          discoverUsers = true;
        }; in "${greeter}/bin/moire-native-login"
      );
      environment.etc."moire-build.json".text = lib.mkForce (builtins.toJSON {
        milestone = "c63-native-desktop";
        revision = "r10-visible-virtual-wave";
        userPickerAcceptance = false;
        waveAcceptance = false;
        desktopAcceptance = false;
        sources = builtins.listToAttrs (map (name: {
          inherit name;
          value = builtins.hashFile "sha256" (../. + "/${name}");
        }) [
          "apps/system/compositor/src/main.ts"
          "apps/system/compositor/src/native-session.ts"
          "apps/system/compositor/src/owned-apps.ts"
          "apps/system/compositor/src/pre-login.ts"
          "apps/system/display-manager/src/native-greetd-client.ts"
          "apps/system/display-manager/src/native-greetd-client.smoke.ts"
          "apps/system/compositor/src/local-users.ts"
          "apps/system/compositor/src/local-users.smoke.ts"
          "packages/core/src/server.ts"
          "packages/sys/src/seat.ts"
          "packages/sys/src/index.ts"
          "packages/sys/src/keymap.ts"
          "packages/sys/src/keyboard-state.ts"
          "packages/sys/test/keyboard-state.native.smoke.ts"
          "packages/core/test/files-interaction.native.smoke.tsx"
          "packages/ui/src/platforms/wayland/keyboard.ts"
          "packages/ui/src/platforms/wayland/xkb.ts"
          "apps/bundled/files/src/main.tsx"
          "packages/shell/src/controller.ts"
          "packages/shell/src/QuickSettingsDetails.tsx"
          "packages/ui/src/window.ts"
          "packages/ui/src/platform.ts"
          "packages/ui/src/retained-motion-admission.ts"
          "packages/ui/src/retained-motion-admission.smoke.ts"
          "packages/ui/src/backdrop/backdrop.tsx"
          "packages/ui/src/backdrop/placement.ts"
          "packages/ui/src/platforms/wayland/index.ts"
          "packages/ui/src/platforms/wayland/rendering.ts"
          "packages/ui/src/platforms/wayland/rendering.smoke.ts"
          "apps/system/greeter/src/native/main.tsx"
          "apps/system/greeter/src/native/view.tsx"
          "apps/system/greeter/src/native/wave.smoke.tsx"
          "apps/system/greeter/src/native/local-users.ts"
          "apps/system/greeter/src/native/user-selection.ts"
          "apps/system/greeter/src/native/user-picker.smoke.tsx"
          "nix/moire-native-login.nix"
          "packages/react-host/src/index.ts"
          "nix/moire-native-desktop.nix"
          "nix/moire-native-desktop-image.nix"
          "nix/moire.nix"
          "pnpm-lock.yaml"
          "flake.lock"
        ]);
      });
    }) ];
  };
in machine.config.system.build.isoImage
